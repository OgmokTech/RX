import { query, withTransaction } from '../../db/postgres.js';
import { decrypt, encrypt } from '../../utils/crypto.js';
import { badRequest, forbidden, notFound } from '../../utils/httpError.js';
import { invalidatePattern } from '../../utils/cache.js';

/** Everything a clinician needs on one screen — fetched in parallel, one round trip each. */
export async function getChart(patientId) {
  const [patient, allergies, meds, conditions, encounters, prescriptions, labs] = await Promise.all([
    query(`SELECT id, mrn, first_name, last_name, birth_date, sex, blood_type, phone,
                  date_part('year', age(birth_date))::int AS age FROM patients WHERE id = $1`, [patientId]),
    query('SELECT id, substance, reaction, severity, created_at FROM allergies WHERE patient_id = $1 ORDER BY severity DESC, substance', [patientId]),
    query(`SELECT id, name, dosage, started_on, drug_id FROM patient_medications
            WHERE patient_id = $1 AND ended_on IS NULL ORDER BY started_on DESC`, [patientId]),
    query('SELECT id, icd10_code, description, onset_date, is_chronic, resolved_on FROM conditions WHERE patient_id = $1 ORDER BY resolved_on NULLS FIRST, onset_date DESC', [patientId]),
    query(`SELECT e.id, e.appointment_id, e.chief_complaint, e.notes_enc, e.vitals, e.diagnoses, e.follow_up_on, e.created_at,
                  d.first_name || ' ' || d.last_name AS doctor_name
             FROM encounters e JOIN doctors d ON d.id = e.doctor_id
            WHERE e.patient_id = $1 ORDER BY e.created_at DESC LIMIT 20`, [patientId]),
    query(`SELECT r.id, r.rx_no, r.status, r.issued_at, d.first_name || ' ' || d.last_name AS doctor_name,
                  (SELECT json_agg(json_build_object('name', dr.generic_name || ' ' || dr.strength, 'dose', i.dose, 'frequency', i.frequency))
                     FROM prescription_items i JOIN drugs dr ON dr.id = i.drug_id WHERE i.prescription_id = r.id) AS items
             FROM prescriptions r JOIN doctors d ON d.id = r.doctor_id
            WHERE r.patient_id = $1 ORDER BY r.issued_at DESC LIMIT 20`, [patientId]),
    query(`SELECT o.id, o.status, o.priority, o.ordered_at,
                  json_agg(json_build_object('test', t.name, 'value', i.result_value, 'unit', i.result_unit,
                           'range', coalesce(i.reference_range, t.reference_range), 'flag', i.abnormal_flag, 'status', i.status)
                           ORDER BY t.name) AS items
             FROM lab_orders o JOIN lab_order_items i ON i.lab_order_id = o.id JOIN lab_tests t ON t.id = i.lab_test_id
            WHERE o.patient_id = $1 GROUP BY o.id ORDER BY o.ordered_at DESC LIMIT 20`, [patientId]),
  ]);
  if (!patient.rows[0]) throw notFound('Patient');
  return {
    patient: patient.rows[0],
    allergies: allergies.rows,
    medications: meds.rows,
    conditions: conditions.rows,
    encounters: encounters.rows.map(({ notes_enc, ...e }) => ({ ...e, notes: decrypt(notes_enc) })),
    prescriptions: prescriptions.rows,
    labOrders: labs.rows,
  };
}

export async function addAllergy(patientId, userId, a) {
  const { rows: [row] } = await query(
    `INSERT INTO allergies (patient_id, substance, reaction, severity, recorded_by) VALUES ($1,$2,$3,$4,$5)
     RETURNING id, substance, reaction, severity, created_at`,
    [patientId, a.substance, a.reaction ?? null, a.severity, userId]
  );
  return row;
}

export const removeAllergy = (patientId, id) =>
  query('DELETE FROM allergies WHERE id = $1 AND patient_id = $2', [id, patientId]);

export async function addMedication(patientId, m) {
  const { rows: [row] } = await query(
    `INSERT INTO patient_medications (patient_id, drug_id, name, dosage, started_on)
     VALUES ($1,$2,$3,$4,coalesce($5, current_date)) RETURNING id, name, dosage, started_on, drug_id`,
    [patientId, m.drugId ?? null, m.name, m.dosage ?? null, m.startedOn ?? null]
  );
  return row;
}

export const stopMedication = (patientId, id) =>
  query('UPDATE patient_medications SET ended_on = current_date WHERE id = $1 AND patient_id = $2 AND ended_on IS NULL', [id, patientId]);

export async function addCondition(patientId, c) {
  const { rows: [row] } = await query(
    `INSERT INTO conditions (patient_id, icd10_code, description, onset_date, is_chronic)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [patientId, c.icd10Code ?? null, c.description, c.onsetDate ?? null, c.isChronic ?? false]
  );
  return row;
}

/** Records a consultation and closes the appointment in the same transaction. */
export async function createEncounter(doctorId, e) {
  return withTransaction(async (c) => {
    if (e.appointmentId) {
      const { rows: [appt] } = await c.query(
        'SELECT doctor_id, patient_id, status FROM appointments WHERE id = $1 FOR UPDATE', [e.appointmentId]);
      if (!appt) throw notFound('Appointment');
      if (appt.doctor_id !== doctorId) throw forbidden('This appointment belongs to another doctor');
      if (appt.patient_id !== e.patientId) throw badRequest('Appointment does not match patient');
      await c.query(`UPDATE appointments SET status = 'completed' WHERE id = $1`, [e.appointmentId]);
    }
    const { rows: [row] } = await c.query(
      `INSERT INTO encounters (appointment_id, patient_id, doctor_id, chief_complaint, notes_enc, vitals, diagnoses, follow_up_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
      [e.appointmentId ?? null, e.patientId, doctorId, e.chiefComplaint ?? null, encrypt(e.notes),
       e.vitals ?? {}, e.diagnoses ?? [], e.followUpOn ?? null]
    );
    return row;
  }).finally(() => invalidatePattern(`cache:report:*`));
}
