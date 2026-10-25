import { query, withTransaction } from '../../db/postgres.js';
import { enqueue } from '../../jobs/queue.js';
import { cached, cacheKeys } from '../../utils/cache.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/httpError.js';
import { checkPrescriptionSafety } from './safety.js';

export const searchDrugs = (q) =>
  cached(cacheKeys.drugs(q), 3600, async () => {
    const { rows } = await query(
      `SELECT id, generic_name, brand_name, drug_class, form, strength, is_controlled FROM drugs
        WHERE $1::text IS NULL OR (generic_name || ' ' || coalesce(brand_name,'')) ILIKE '%' || $1 || '%'
        ORDER BY generic_name, strength LIMIT 25`,
      [q || null]
    );
    return rows;
  });

export const listPharmacies = async () =>
  (await query('SELECT id, name, address, phone FROM pharmacies WHERE is_active ORDER BY name')).rows;

/** Gathers everything the safety engine needs in 3 indexed queries. */
export async function runSafetyCheck(patientId, drugIds) {
  const [newDrugs, current, allergies] = await Promise.all([
    query('SELECT id, generic_name, drug_class FROM drugs WHERE id = ANY($1::uuid[])', [drugIds]),
    query(`SELECT d.id, d.generic_name, d.drug_class FROM patient_medications m JOIN drugs d ON d.id = m.drug_id
            WHERE m.patient_id = $1 AND m.ended_on IS NULL`, [patientId]),
    query('SELECT substance, severity FROM allergies WHERE patient_id = $1', [patientId]),
  ]);
  if (newDrugs.rowCount !== new Set(drugIds).size) throw badRequest('One or more drugs are not in the formulary');
  const allIds = [...new Set([...drugIds, ...current.rows.map((d) => d.id)])];
  const { rows: interactions } = await query(
    `SELECT drug_a_id, drug_b_id, severity, description FROM drug_interactions
      WHERE drug_a_id = ANY($1::uuid[]) AND drug_b_id = ANY($1::uuid[])`,
    [allIds]
  );
  return checkPrescriptionSafety({ newDrugs: newDrugs.rows, currentDrugs: current.rows, allergies: allergies.rows, interactions });
}

export async function create(doctorId, input) {
  const safety = await runSafetyCheck(input.patientId, input.items.map((i) => i.drugId));
  if (safety.blocking && !input.overrideReason) {
    // 409 + alerts: the UI shows them and asks the doctor for a documented override reason
    throw conflict('Safety alerts need review before signing', { alerts: safety.alerts });
  }

  const rx = await withTransaction(async (c) => {
    const { rows: [rx] } = await c.query(
      `INSERT INTO prescriptions (patient_id, doctor_id, encounter_id, pharmacy_id, notes, override_reason, safety_alerts)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.patientId, doctorId, input.encounterId ?? null, input.pharmacyId ?? null, input.notes ?? null,
       safety.alerts.length ? input.overrideReason ?? null : null, JSON.stringify(safety.alerts)]
    );
    for (const it of input.items) {
      await c.query(
        `INSERT INTO prescription_items (prescription_id, drug_id, dose, frequency, route, duration_days, quantity, instructions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [rx.id, it.drugId, it.dose, it.frequency, it.route, it.durationDays ?? null, it.quantity, it.instructions ?? null]
      );
      // Future safety checks see this drug as an active medication
      await c.query(
        `INSERT INTO patient_medications (patient_id, drug_id, name, dosage, source_rx_id)
         SELECT $1, d.id, d.generic_name || ' ' || d.strength, $3 || ', ' || $4, $5 FROM drugs d WHERE d.id = $2`,
        [input.patientId, it.drugId, it.dose, it.frequency, rx.id]
      );
    }
    return rx;
  });

  if (rx.pharmacy_id) await enqueue('pharmacy.send', { prescriptionId: rx.id });
  return { ...rx, alerts: safety.alerts };
}

export async function list(user, { patientId, page, pageSize }) {
  const scopePatient = user.role === 'patient' ? user.patientId : patientId ?? null;
  const { rows } = await query(
    `SELECT r.id, r.rx_no, r.status, r.issued_at, r.valid_until, r.patient_id,
            p.first_name || ' ' || p.last_name AS patient_name,
            'Dr. ' || d.first_name || ' ' || d.last_name AS doctor_name,
            (SELECT count(*) FROM prescription_items i WHERE i.prescription_id = r.id) AS item_count,
            count(*) OVER() AS total_count
       FROM prescriptions r JOIN patients p ON p.id = r.patient_id JOIN doctors d ON d.id = r.doctor_id
      WHERE ($1::uuid IS NULL OR r.patient_id = $1) AND ($2::uuid IS NULL OR r.doctor_id = $2)
      ORDER BY r.issued_at DESC LIMIT $3 OFFSET $4`,
    [scopePatient, user.role === 'doctor' ? user.doctorId : null, pageSize, (page - 1) * pageSize]
  );
  return rows;
}

export async function getOne(user, id) {
  const { rows: [rx] } = await query(
    `SELECT r.*, p.first_name || ' ' || p.last_name AS patient_name, p.birth_date, p.sex, p.mrn,
            coalesce(p.address->>'city', '') AS patient_city,
            date_part('year', age(p.birth_date))::int AS patient_age,
            d.first_name || ' ' || d.last_name AS doctor_name, d.specialization, d.license_no, d.ptr_no, d.s2_no,
            ph.name AS pharmacy_name,
            (SELECT json_agg(json_build_object('id', i.id, 'generic_name', dr.generic_name, 'brand_name', dr.brand_name,
                    'form', dr.form, 'strength', dr.strength, 'is_controlled', dr.is_controlled, 'dose', i.dose, 'frequency', i.frequency, 'route', i.route,
                    'duration_days', i.duration_days, 'quantity', i.quantity, 'instructions', i.instructions))
               FROM prescription_items i JOIN drugs dr ON dr.id = i.drug_id WHERE i.prescription_id = r.id) AS items
       FROM prescriptions r
       JOIN patients p ON p.id = r.patient_id
       JOIN doctors d ON d.id = r.doctor_id
       LEFT JOIN pharmacies ph ON ph.id = r.pharmacy_id
      WHERE r.id = $1`,
    [id]
  );
  if (!rx) throw notFound('Prescription');
  if (user.role === 'patient' && rx.patient_id !== user.patientId) throw forbidden();
  if (user.role === 'doctor' && rx.doctor_id !== user.doctorId) {
    const { rowCount } = await query('SELECT 1 FROM appointments WHERE doctor_id=$1 AND patient_id=$2 LIMIT 1', [user.doctorId, rx.patient_id]);
    if (!rowCount) throw forbidden();
  }
  return rx;
}

export async function setStatus(user, id, status) {
  const { rows: [rx] } = await query(
    `UPDATE prescriptions SET status = $2 WHERE id = $1 AND status = 'active' AND ($3::uuid IS NULL OR doctor_id = $3) RETURNING id, status`,
    [id, status, user.role === 'doctor' ? user.doctorId : null]
  );
  if (!rx) throw badRequest('Only your active prescriptions can be changed');
  if (status === 'cancelled') await query('UPDATE patient_medications SET ended_on = current_date WHERE source_rx_id = $1 AND ended_on IS NULL', [id]);
  return rx;
}
