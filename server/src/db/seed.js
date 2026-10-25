// Development seed data. All accounts use the password below — never run in production.
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from './postgres.js';

const PASSWORD = 'Clinic2026!Pass';

async function seed() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) {
    console.log('Database already has users — skipping seed.');
    return pool.end();
  }
  const hash = await bcrypt.hash(PASSWORD, 12);

  await withTransaction(async (c) => {
    const user = async (email, role) =>
      (await c.query('INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3) RETURNING id', [email, hash, role])).rows[0].id;

    // Staff
    const adminId = await user('admin@rxclinic.local', 'admin');
    await c.query(`INSERT INTO staff (user_id, first_name, last_name, position) VALUES ($1,'Maria','Santos','Clinic Administrator')`, [adminId]);
    const recId = await user('reception@rxclinic.local', 'receptionist');
    await c.query(`INSERT INTO staff (user_id, first_name, last_name, position) VALUES ($1,'Jun','Villanueva','Front Desk')`, [recId]);

    // Doctors with Mon–Sat clinic hours (8–12, 1–5), 30-minute slots
    const doctors = [
      ['dr.reyes@rxclinic.local', 'Antonio', 'Reyes', 'Internal Medicine', '0098765', 600],
      ['dr.garcia@rxclinic.local', 'Liza', 'Garcia', 'Pediatrics', '0112233', 550],
    ];
    const doctorIds = [];
    for (const [email, fn, ln, spec, lic, fee] of doctors) {
      const uid = await user(email, 'doctor');
      const { rows: [d] } = await c.query(
        `INSERT INTO doctors (user_id, first_name, last_name, specialization, license_no, ptr_no, consultation_fee)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [uid, fn, ln, spec, lic, `PTR-${lic}`, fee]);
      doctorIds.push(d.id);
      for (let wd = 1; wd <= 6; wd++) {
        await c.query(`INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes)
                       VALUES ($1,$2,'08:00','12:00',30), ($1,$2,'13:00','17:00',30)`, [d.id, wd]);
      }
    }

    // Patients
    const pUid = await user('juan@example.com', 'patient');
    const { rows: [juan] } = await c.query(
      `INSERT INTO patients (user_id, first_name, last_name, birth_date, sex, phone, email, blood_type, address)
       VALUES ($1,'Juan','Dela Cruz','1958-03-14','male','09171234567','juan@example.com','O+',
               '{"barangay":"Cogon","city":"Ormoc City","province":"Leyte"}') RETURNING id`, [pUid]);
    const p2Uid = await user('ana@example.com', 'patient');
    await c.query(
      `INSERT INTO patients (user_id, first_name, last_name, birth_date, sex, phone, email)
       VALUES ($1,'Ana','Bautista','1992-11-02','female','09181234567','ana@example.com')`, [p2Uid]);
    await c.query(`INSERT INTO allergies (patient_id, substance, reaction, severity) VALUES ($1,'Penicillin','Hives, facial swelling','severe')`, [juan.id]);

    // A completed past visit each, so the demo doctors have a care relationship
    // (charts, prescribing and messaging all require one) right after seeding.
    const ana = (await c.query("SELECT id FROM patients WHERE email = 'ana@example.com'")).rows[0];
    await c.query(
      `INSERT INTO appointments (patient_id, doctor_id, starts_at, ends_at, type, status, reason, created_by)
       VALUES ($1, $2, date_trunc('day', now() - interval '7 days') + interval '1 hour', date_trunc('day', now() - interval '7 days') + interval '90 minutes',
               'in_person', 'completed', 'Blood pressure follow-up', $3),
              ($4, $5, date_trunc('day', now() - interval '5 days') + interval '2 hours', date_trunc('day', now() - interval '5 days') + interval '150 minutes',
               'in_person', 'completed', 'Seasonal allergies', $6)`,
      [juan.id, doctorIds[0], pUid, ana.id, doctorIds[1], p2Uid]
    );

    // Formulary + interactions
    const drugs = [
      ['Amoxicillin', 'Amoxil', 'penicillin', 'capsule', '500 mg'],
      ['Co-amoxiclav', 'Augmentin', 'penicillin', 'tablet', '625 mg'],
      ['Azithromycin', 'Zithromax', 'macrolide', 'tablet', '500 mg'],
      ['Clarithromycin', 'Klaricid', 'macrolide', 'tablet', '500 mg'],
      ['Paracetamol', 'Biogesic', 'analgesic', 'tablet', '500 mg'],
      ['Ibuprofen', 'Advil', 'nsaid', 'tablet', '400 mg'],
      ['Aspirin', 'Aspilets', 'nsaid', 'tablet', '80 mg'],
      ['Warfarin', 'Coumadin', 'anticoagulant', 'tablet', '5 mg'],
      ['Losartan', 'Cozaar', 'arb', 'tablet', '50 mg'],
      ['Amlodipine', 'Norvasc', 'calcium channel blocker', 'tablet', '5 mg'],
      ['Metformin', 'Glucophage', 'biguanide', 'tablet', '500 mg'],
      ['Simvastatin', 'Zocor', 'statin', 'tablet', '20 mg'],
      ['Cetirizine', 'Virlix', 'antihistamine', 'tablet', '10 mg'],
      ['Salbutamol', 'Ventolin', 'beta-agonist', 'nebule', '2.5 mg/2.5 mL'],
    ];
    const id = {};
    for (const [g, b, cls, form, str] of drugs) {
      id[g] = (await c.query(
        'INSERT INTO drugs (generic_name, brand_name, drug_class, form, strength) VALUES ($1,$2,$3,$4,$5) RETURNING id', [g, b, cls, form, str])).rows[0].id;
    }
    const interactions = [
      ['Warfarin', 'Aspirin', 'major', 'Additive bleeding risk. Avoid unless specifically indicated; monitor INR closely.'],
      ['Warfarin', 'Ibuprofen', 'major', 'NSAIDs raise bleeding risk and may increase INR.'],
      ['Simvastatin', 'Clarithromycin', 'contraindicated', 'CYP3A4 inhibition raises statin levels — risk of rhabdomyolysis.'],
      ['Ibuprofen', 'Losartan', 'moderate', 'NSAIDs can blunt the antihypertensive effect and impair renal function.'],
      ['Warfarin', 'Azithromycin', 'moderate', 'May potentiate anticoagulant effect; monitor INR.'],
      ['Ibuprofen', 'Aspirin', 'moderate', 'Ibuprofen may reduce the cardioprotective effect of low-dose aspirin.'],
    ];
    for (const [a, b, sev, desc] of interactions) {
      const [x, y] = [id[a], id[b]].sort();
      await c.query('INSERT INTO drug_interactions VALUES ($1,$2,$3,$4)', [x, y, sev, desc]);
    }
    await c.query(`INSERT INTO patient_medications (patient_id, drug_id, name, dosage) VALUES ($1,$2,'Losartan 50 mg','1 tablet once daily')`, [juan.id, id.Losartan]);

    // Lab catalog (prices in PHP)
    await c.query(`INSERT INTO lab_tests (code, name, specimen, unit, reference_range, price, turnaround_hours) VALUES
      ('CBC','Complete Blood Count','Whole blood',NULL,NULL,350,4),
      ('FBS','Fasting Blood Sugar','Serum','mg/dL','70–99',150,2),
      ('HBA1C','Hemoglobin A1c','Whole blood','%','< 5.7',900,24),
      ('LIPID','Lipid Profile','Serum','mg/dL','See report',800,6),
      ('CREA','Creatinine','Serum','mg/dL','0.7–1.3',200,4),
      ('UA','Urinalysis','Urine',NULL,NULL,120,2)`);

    await c.query(`INSERT INTO pharmacies (name, address, phone) VALUES
      ('Mercury Drug – Ormoc Real St.','Real St., Ormoc City','(053) 561-0000'),
      ('Rose Pharmacy – Ormoc','Aviles St., Ormoc City','(053) 561-1111')`);

    // Inventory with opening stock via the ledger (trigger computes quantity_on_hand)
    const items = [
      ['MED-PCM500', 'Paracetamol 500 mg tablet', 'medicine', 'tab', 200, 1000],
      ['SUP-GLOVE-M', 'Nitrile gloves, medium', 'supply', 'box', 10, 6],
      ['SUP-SYR-3', 'Disposable syringe 3 mL', 'supply', 'pc', 100, 450],
      ['RGT-GLU', 'Glucose test strips', 'reagent', 'strip', 50, 40],
      ['EQP-BPCUFF', 'BP cuff, adult', 'equipment', 'pc', 2, 4],
    ];
    for (const [sku, name, cat, unit, reorder, qty] of items) {
      const { rows: [it] } = await c.query(
        'INSERT INTO inventory_items (sku, name, category, unit, reorder_level) VALUES ($1,$2,$3,$4,$5) RETURNING id', [sku, name, cat, unit, reorder]);
      await c.query(`INSERT INTO inventory_transactions (item_id, change, reason, reference, created_by) VALUES ($1,$2,'restock','Opening stock',$3)`, [it.id, qty, adminId]);
    }
  });

  console.log(`✔ Seeded. Every account's password: ${PASSWORD}`);
  console.log('  admin@rxclinic.local · reception@rxclinic.local · dr.reyes@rxclinic.local · dr.garcia@rxclinic.local · juan@example.com · ana@example.com');
  await pool.end();
}

seed().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
