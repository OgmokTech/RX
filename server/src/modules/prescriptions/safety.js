// Pure prescription-safety engine (unit-tested). Runs before a prescription is signed.

const RANK = { minor: 1, moderate: 2, major: 3, contraindicated: 4 };
export const BLOCKING = new Set(['major', 'contraindicated']);

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * @param {object} args
 * @param {{id:string, generic_name:string, drug_class?:string}[]} args.newDrugs      drugs being prescribed
 * @param {{id:string, generic_name:string, drug_class?:string}[]} args.currentDrugs  patient's active medications (formulary-linked)
 * @param {{substance:string, severity:'mild'|'moderate'|'severe'}[]} args.allergies
 * @param {{drug_a_id:string, drug_b_id:string, severity:string, description:string}[]} args.interactions
 */
export function checkPrescriptionSafety({ newDrugs, currentDrugs = [], allergies = [], interactions = [] }) {
  const alerts = [];
  const interactionMap = new Map(interactions.map((i) => [pairKey(i.drug_a_id, i.drug_b_id), i]));

  for (const drug of newDrugs) {
    // 1. Allergy: match on generic name or drug class (penicillin allergy → amoxicillin)
    const names = [drug.generic_name, drug.drug_class].filter(Boolean).map((s) => s.toLowerCase());
    for (const allergy of allergies) {
      const substance = allergy.substance.toLowerCase();
      if (names.some((n) => n === substance || n.includes(substance))) {
        alerts.push({
          type: 'allergy', drugId: drug.id,
          severity: allergy.severity === 'severe' ? 'contraindicated' : 'major',
          message: `Patient is allergic to ${allergy.substance} (${allergy.severity}). ${drug.generic_name} may trigger a reaction.`,
        });
      }
    }
    // 2. Duplicate therapy
    if (currentDrugs.some((c) => c.id === drug.id)) {
      alerts.push({ type: 'duplicate', drugId: drug.id, severity: 'moderate', message: `${drug.generic_name} is already an active medication.` });
    }
  }

  // 3. Drug–drug interactions: new × current, and new × new
  const seen = new Set();
  const check = (a, b) => {
    const key = pairKey(a.id, b.id);
    if (a.id === b.id || seen.has(key)) return;
    seen.add(key);
    const hit = interactionMap.get(key);
    if (hit) {
      alerts.push({
        type: 'interaction', drugId: a.id, otherDrugId: b.id, severity: hit.severity,
        message: `${a.generic_name} + ${b.generic_name}: ${hit.description}`,
      });
    }
  };
  newDrugs.forEach((a, i) => {
    currentDrugs.forEach((b) => check(a, b));
    newDrugs.slice(i + 1).forEach((b) => check(a, b));
  });

  alerts.sort((x, y) => RANK[y.severity] - RANK[x.severity]);
  return { alerts, blocking: alerts.some((a) => BLOCKING.has(a.severity)) };
}
