-- =====================================================================
-- RX Clinic Information System — core relational schema (PostgreSQL 16)
-- Transactional, relational data lives here: identities, scheduling,
-- clinical records, prescriptions, labs, billing, inventory.
-- High-volume / schemaless data (audit logs, chat, telemetry) is in MongoDB.
-- Hot, short-lived data (slot cache, sessions, rate limits, queues) is in Redis.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive emails
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- uuid equality inside GiST exclusion constraints
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fast ILIKE '%name%' patient search

-- ---------- Enumerations (compact 4-byte storage, self-documenting) ----------
CREATE TYPE user_role          AS ENUM ('patient','doctor','admin','receptionist');
CREATE TYPE sex_type           AS ENUM ('male','female','intersex','unspecified');
CREATE TYPE appointment_status AS ENUM ('scheduled','confirmed','checked_in','completed','cancelled','no_show');
CREATE TYPE appointment_type   AS ENUM ('in_person','telemedicine');
CREATE TYPE severity_level     AS ENUM ('mild','moderate','severe');
CREATE TYPE interaction_level  AS ENUM ('minor','moderate','major','contraindicated');
CREATE TYPE rx_status          AS ENUM ('active','dispensed','cancelled','expired');
CREATE TYPE lab_status         AS ENUM ('ordered','collected','in_progress','resulted','cancelled');
CREATE TYPE lab_priority       AS ENUM ('routine','urgent','stat');
CREATE TYPE invoice_status     AS ENUM ('draft','issued','partially_paid','paid','void');
CREATE TYPE discount_type      AS ENUM ('none','senior','pwd','manual');
CREATE TYPE payment_method     AS ENUM ('cash','card','gcash','maya','bank_transfer','insurance');
CREATE TYPE payment_status     AS ENUM ('pending','succeeded','failed','refunded');
CREATE TYPE claim_status       AS ENUM ('draft','submitted','approved','partially_approved','denied','paid');
CREATE TYPE inv_reason         AS ENUM ('restock','dispense','adjustment','expired','return');

-- ---------- Shared trigger: maintain updated_at ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ---------- Human-readable document numbers ----------
CREATE SEQUENCE mrn_seq;
CREATE SEQUENCE invoice_seq;
CREATE SEQUENCE rx_seq;

-- =====================================================================
-- IDENTITY & PROFILES
-- One users row per login; role-specific profile tables hang off it (1:1).
-- Patients can exist without a login (walk-ins registered by reception).
-- =====================================================================
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  password_hash      text   NOT NULL,
  role               user_role NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  mfa_enabled        boolean NOT NULL DEFAULT false,
  mfa_secret_enc     text,                         -- AES-256-GCM ciphertext (app-level)
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role_active ON users (role) WHERE is_active;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE patients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  mrn                text NOT NULL UNIQUE DEFAULT ('MRN-' || lpad(nextval('mrn_seq')::text, 7, '0')),
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  birth_date         date NOT NULL,
  sex                sex_type NOT NULL DEFAULT 'unspecified',
  phone              text,
  email              citext,
  address            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {street, barangay, city, province, zip}
  emergency_contact  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {name, relation, phone}
  blood_type         text CHECK (blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (birth_date <= current_date)
);
-- Trigram GIN index: supports ILIKE '%dela cruz%' without a sequential scan
CREATE INDEX idx_patients_name_trgm ON patients USING gin ((last_name || ' ' || first_name) gin_trgm_ops);
CREATE INDEX idx_patients_phone ON patients (phone);
CREATE TRIGGER trg_patients_updated BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE doctors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  specialization     text NOT NULL,
  license_no         text NOT NULL UNIQUE,              -- PRC license number
  ptr_no             text,                              -- Professional Tax Receipt (printed on Rx)
  s2_no              text,                              -- PDEA S2 license (dangerous drugs)
  consultation_fee   numeric(12,2) NOT NULL DEFAULT 0 CHECK (consultation_fee >= 0),
  bio                text,
  is_accepting       boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_doctors_specialization ON doctors (specialization) WHERE is_accepting;
CREATE TRIGGER trg_doctors_updated BEFORE UPDATE ON doctors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE staff (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  position           text NOT NULL
);

-- Weekly recurring availability. Slots are computed on read and cached in Redis.
CREATE TABLE doctor_schedules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id          uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  weekday            smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time         time NOT NULL,
  end_time           time NOT NULL,
  slot_minutes       smallint NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
  CHECK (end_time > start_time),
  UNIQUE (doctor_id, weekday, start_time)
);

CREATE TABLE doctor_time_off (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id          uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  period             tstzrange NOT NULL,
  reason             text,
  EXCLUDE USING gist (doctor_id WITH =, period WITH &&)
);

CREATE TABLE insurance_policies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  provider           text NOT NULL,                     -- e.g. PhilHealth, Maxicare, Intellicare
  member_no_enc      text NOT NULL,                     -- encrypted at app level
  member_no_last4    text,                              -- display/search helper
  coverage           jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_until        date,
  is_primary         boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_policies_patient ON insurance_policies (patient_id);
CREATE UNIQUE INDEX uq_policies_one_primary ON insurance_policies (patient_id) WHERE is_primary;

-- =====================================================================
-- FORMULARY (reference data, heavily cached)
-- =====================================================================
CREATE TABLE drugs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generic_name       text NOT NULL,
  brand_name         text,
  drug_class         text,                              -- e.g. 'penicillin', 'nsaid' — used for allergy matching
  form               text NOT NULL,                     -- tablet, capsule, syrup...
  strength           text NOT NULL,                     -- 500 mg, 250 mg/5 mL...
  is_controlled      boolean NOT NULL DEFAULT false,
  UNIQUE (generic_name, form, strength)
);
CREATE INDEX idx_drugs_name_trgm ON drugs USING gin ((generic_name || ' ' || coalesce(brand_name,'')) gin_trgm_ops);
CREATE INDEX idx_drugs_class ON drugs (lower(drug_class));

-- Symmetric pair stored once (drug_a_id < drug_b_id) → half the rows, one lookup path.
CREATE TABLE drug_interactions (
  drug_a_id          uuid NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
  drug_b_id          uuid NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
  severity           interaction_level NOT NULL,
  description        text NOT NULL,
  PRIMARY KEY (drug_a_id, drug_b_id),
  CHECK (drug_a_id < drug_b_id)
);
CREATE INDEX idx_interactions_b ON drug_interactions (drug_b_id);

-- =====================================================================
-- MEDICAL HISTORY
-- =====================================================================
CREATE TABLE allergies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  substance          text NOT NULL,
  reaction           text,
  severity           severity_level NOT NULL DEFAULT 'moderate',
  recorded_by        uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_allergy_per_patient ON allergies (patient_id, lower(substance));

CREATE TABLE patient_medications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  drug_id            uuid REFERENCES drugs(id),        -- null for free-text meds not in formulary
  name               text NOT NULL,
  dosage             text,
  started_on         date NOT NULL DEFAULT current_date,
  ended_on           date,
  source_rx_id       uuid,                              -- set when created from a prescription
  CHECK (ended_on IS NULL OR ended_on >= started_on)
);
-- Only current medications matter for interaction checks → small partial index
CREATE INDEX idx_meds_active ON patient_medications (patient_id) WHERE ended_on IS NULL;

CREATE TABLE conditions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  icd10_code         text,
  description        text NOT NULL,
  onset_date         date,
  is_chronic         boolean NOT NULL DEFAULT false,
  resolved_on        date
);
CREATE INDEX idx_conditions_patient ON conditions (patient_id);

-- =====================================================================
-- SCHEDULING
-- =====================================================================
CREATE TABLE appointments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id          uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL,
  type               appointment_type NOT NULL DEFAULT 'in_person',
  status             appointment_status NOT NULL DEFAULT 'scheduled',
  reason             text,
  cancel_reason      text,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- The database itself guarantees no double-booking, even under concurrent requests.
  CONSTRAINT no_doctor_overlap EXCLUDE USING gist (
    doctor_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('scheduled','confirmed','checked_in')),
  CONSTRAINT no_patient_overlap EXCLUDE USING gist (
    patient_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('scheduled','confirmed','checked_in'))
);
CREATE INDEX idx_appt_doctor_time  ON appointments (doctor_id, starts_at);
CREATE INDEX idx_appt_patient_time ON appointments (patient_id, starts_at DESC);
CREATE INDEX idx_appt_care_rel     ON appointments (doctor_id, patient_id);   -- care-relationship checks
CREATE INDEX idx_appt_upcoming     ON appointments (starts_at) WHERE status IN ('scheduled','confirmed');
CREATE TRIGGER trg_appt_updated BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- CONSULTATIONS (encounters) — clinical notes are encrypted by the app
-- =====================================================================
CREATE TABLE encounters (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id     uuid UNIQUE REFERENCES appointments(id),
  patient_id         uuid NOT NULL REFERENCES patients(id),
  doctor_id          uuid NOT NULL REFERENCES doctors(id),
  chief_complaint    text,
  notes_enc          text,                              -- SOAP notes, AES-256-GCM
  vitals             jsonb NOT NULL DEFAULT '{}'::jsonb, -- {bp:"120/80", hr:72, temp:36.8, rr:16, spo2:98, weight_kg, height_cm}
  diagnoses          text[] NOT NULL DEFAULT '{}',      -- ICD-10 codes
  follow_up_on       date,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_encounters_patient ON encounters (patient_id, created_at DESC);
CREATE INDEX idx_encounters_diag ON encounters USING gin (diagnoses);   -- "top diagnoses" analytics

-- =====================================================================
-- PRESCRIPTIONS
-- =====================================================================
CREATE TABLE pharmacies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  address            text,
  phone              text,
  email              citext,
  api_endpoint       text,
  is_active          boolean NOT NULL DEFAULT true
);

CREATE TABLE prescriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rx_no              text NOT NULL UNIQUE DEFAULT ('RX-' || to_char(now(),'YYYY') || '-' || lpad(nextval('rx_seq')::text, 6, '0')),
  patient_id         uuid NOT NULL REFERENCES patients(id),
  doctor_id          uuid NOT NULL REFERENCES doctors(id),
  encounter_id       uuid REFERENCES encounters(id),
  pharmacy_id        uuid REFERENCES pharmacies(id),
  status             rx_status NOT NULL DEFAULT 'active',
  notes              text,
  override_reason    text,                              -- required when safety alerts were overridden
  safety_alerts      jsonb NOT NULL DEFAULT '[]'::jsonb, -- snapshot of alerts shown at signing
  issued_at          timestamptz NOT NULL DEFAULT now(),
  valid_until        date NOT NULL DEFAULT (current_date + 30)
);
CREATE INDEX idx_rx_patient ON prescriptions (patient_id, issued_at DESC);
CREATE INDEX idx_rx_doctor  ON prescriptions (doctor_id, issued_at DESC);

CREATE TABLE prescription_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id    uuid NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  drug_id            uuid NOT NULL REFERENCES drugs(id),
  dose               text NOT NULL,                     -- "1 tablet"
  frequency          text NOT NULL,                     -- "every 8 hours"
  route              text NOT NULL DEFAULT 'oral',
  duration_days      smallint CHECK (duration_days > 0),
  quantity           integer NOT NULL CHECK (quantity > 0),
  instructions       text
);
CREATE INDEX idx_rx_items_rx ON prescription_items (prescription_id);

-- =====================================================================
-- LABORATORY
-- =====================================================================
CREATE TABLE lab_tests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  name               text NOT NULL,
  specimen           text,
  unit               text,
  reference_range    text,
  price              numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  turnaround_hours   smallint
);

CREATE TABLE lab_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patients(id),
  doctor_id          uuid NOT NULL REFERENCES doctors(id),
  encounter_id       uuid REFERENCES encounters(id),
  status             lab_status NOT NULL DEFAULT 'ordered',
  priority           lab_priority NOT NULL DEFAULT 'routine',
  clinical_notes     text,
  ordered_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);
CREATE INDEX idx_lab_orders_patient ON lab_orders (patient_id, ordered_at DESC);
CREATE INDEX idx_lab_orders_open    ON lab_orders (status, priority, ordered_at) WHERE status NOT IN ('resulted','cancelled');

CREATE TABLE lab_order_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_order_id       uuid NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  lab_test_id        uuid NOT NULL REFERENCES lab_tests(id),
  status             lab_status NOT NULL DEFAULT 'ordered',
  result_value       text,
  result_unit        text,
  reference_range    text,
  abnormal_flag      text CHECK (abnormal_flag IN ('L','H','LL','HH','A')),
  result_notes       text,
  resulted_by        uuid REFERENCES users(id),
  resulted_at        timestamptz,
  UNIQUE (lab_order_id, lab_test_id)
);

-- =====================================================================
-- BILLING — amounts in numeric(12,2); balances derived, never hand-edited
-- =====================================================================
CREATE TABLE invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no         text NOT NULL UNIQUE DEFAULT ('INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 6, '0')),
  patient_id         uuid NOT NULL REFERENCES patients(id),
  appointment_id     uuid REFERENCES appointments(id),
  status             invoice_status NOT NULL DEFAULT 'issued',
  discount_type      discount_type NOT NULL DEFAULT 'none',
  subtotal           numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  discount           numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax                numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total              numeric(12,2) NOT NULL CHECK (total >= 0),
  amount_paid        numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  balance            numeric(12,2) GENERATED ALWAYS AS (total - amount_paid) STORED,
  due_date           date,
  issued_by          uuid REFERENCES users(id),
  issued_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_paid <= total)
);
CREATE INDEX idx_invoices_patient ON invoices (patient_id, issued_at DESC);
CREATE INDEX idx_invoices_unpaid  ON invoices (due_date) WHERE status IN ('issued','partially_paid');

CREATE TABLE invoice_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_type          text NOT NULL CHECK (item_type IN ('consultation','procedure','lab','medication','supply','other')),
  description        text NOT NULL,
  quantity           numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price         numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total         numeric(12,2) GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items (invoice_id);

CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         uuid NOT NULL REFERENCES invoices(id),
  amount             numeric(12,2) NOT NULL CHECK (amount > 0),
  method             payment_method NOT NULL,
  status             payment_status NOT NULL DEFAULT 'succeeded',
  reference          text,                              -- OR number / gateway transaction id
  gateway            text,
  idempotency_key    text UNIQUE,                       -- prevents double charge on retries
  received_by        uuid REFERENCES users(id),
  paid_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_invoice ON payments (invoice_id);
CREATE INDEX idx_payments_paid_at ON payments (paid_at) WHERE status = 'succeeded';

-- Keep invoices.amount_paid + status consistent with payments, inside the same transaction.
CREATE OR REPLACE FUNCTION sync_invoice_payment() RETURNS trigger AS $$
DECLARE v_invoice uuid := coalesce(NEW.invoice_id, OLD.invoice_id);
BEGIN
  UPDATE invoices i
     SET amount_paid = p.paid,
         status = CASE
           WHEN i.status = 'void' THEN 'void'
           WHEN p.paid >= i.total THEN 'paid'
           WHEN p.paid > 0        THEN 'partially_paid'
           ELSE 'issued' END::invoice_status
    FROM (SELECT coalesce(sum(amount),0) AS paid FROM payments
           WHERE invoice_id = v_invoice AND status = 'succeeded') p
   WHERE i.id = v_invoice;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_payments_sync AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION sync_invoice_payment();

CREATE TABLE insurance_claims (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         uuid NOT NULL REFERENCES invoices(id),
  policy_id          uuid NOT NULL REFERENCES insurance_policies(id),
  amount_claimed     numeric(12,2) NOT NULL CHECK (amount_claimed > 0),
  amount_approved    numeric(12,2) CHECK (amount_approved >= 0),
  status             claim_status NOT NULL DEFAULT 'submitted',
  external_ref       text,
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  decided_at         timestamptz
);
CREATE INDEX idx_claims_open ON insurance_claims (status) WHERE status IN ('submitted','approved','partially_approved');

-- =====================================================================
-- INVENTORY — ledger pattern: transactions are the source of truth,
-- quantity_on_hand is a trigger-maintained running balance.
-- =====================================================================
CREATE TABLE inventory_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                text NOT NULL UNIQUE,
  name               text NOT NULL,
  category           text NOT NULL CHECK (category IN ('medicine','supply','equipment','reagent')),
  unit               text NOT NULL DEFAULT 'pc',
  reorder_level      integer NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
  quantity_on_hand   integer NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  unit_cost          numeric(12,2) NOT NULL DEFAULT 0,
  expiry_date        date,
  is_active          boolean NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Low-stock dashboard reads only the (few) rows that need attention
CREATE INDEX idx_inventory_low ON inventory_items (name) WHERE is_active AND quantity_on_hand <= reorder_level;
CREATE INDEX idx_inventory_name_trgm ON inventory_items USING gin (name gin_trgm_ops);

CREATE TABLE inventory_transactions (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id            uuid NOT NULL REFERENCES inventory_items(id),
  change             integer NOT NULL CHECK (change <> 0),
  reason             inv_reason NOT NULL,
  reference          text,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inv_txn_item ON inventory_transactions (item_id, created_at DESC);

CREATE OR REPLACE FUNCTION apply_inventory_txn() RETURNS trigger AS $$
BEGIN
  -- CHECK (quantity_on_hand >= 0) rejects overdrawing stock
  UPDATE inventory_items
     SET quantity_on_hand = quantity_on_hand + NEW.change, updated_at = now()
   WHERE id = NEW.item_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_inventory_apply AFTER INSERT ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION apply_inventory_txn();
