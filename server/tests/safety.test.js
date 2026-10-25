import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPrescriptionSafety } from '../src/modules/prescriptions/safety.js';

const amox = { id: 'a', generic_name: 'Amoxicillin', drug_class: 'penicillin' };
const warfarin = { id: 'w', generic_name: 'Warfarin', drug_class: 'anticoagulant' };
const aspirin = { id: 's', generic_name: 'Aspirin', drug_class: 'nsaid' };
const interactions = [{ drug_a_id: 's', drug_b_id: 'w', severity: 'major', description: 'Bleeding risk' }];

test('class-level allergy match blocks the prescription', () => {
  const r = checkPrescriptionSafety({ newDrugs: [amox], allergies: [{ substance: 'Penicillin', severity: 'severe' }] });
  assert.equal(r.blocking, true);
  assert.equal(r.alerts[0].severity, 'contraindicated');
});

test('interaction with an active medication is detected in either order', () => {
  const r = checkPrescriptionSafety({ newDrugs: [aspirin], currentDrugs: [warfarin], interactions });
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].type, 'interaction');
  assert.equal(r.blocking, true);
});

test('interaction between two new drugs is detected once', () => {
  const r = checkPrescriptionSafety({ newDrugs: [warfarin, aspirin], interactions });
  assert.equal(r.alerts.filter((a) => a.type === 'interaction').length, 1);
});

test('duplicate therapy is a non-blocking warning', () => {
  const r = checkPrescriptionSafety({ newDrugs: [warfarin], currentDrugs: [warfarin] });
  assert.equal(r.alerts[0].type, 'duplicate');
  assert.equal(r.blocking, false);
});
