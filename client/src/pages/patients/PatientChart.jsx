import { Alert, Box, Button, Chip, Grid, List, ListItem, ListItemText, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/http.js';
import { QueryState, Section, StatusChip } from '../../components/common.jsx';
import { useToast } from '../../components/Toast.jsx';
import { date, dateTime, label } from '../../utils/format.js';
import InvoiceDialog from '../billing/InvoiceDialog.jsx';
import EncounterForm from './chart/EncounterForm.jsx';
import LabOrderDialog from './chart/LabOrderDialog.jsx';
import PrescriptionDialog from './chart/PrescriptionDialog.jsx';

/** Small inline "add" form used for allergies, medications and conditions. */
function QuickAdd({ fields, onSubmit, busy }) {
  const [v, setV] = useState(() => Object.fromEntries(fields.map((f) => [f.name, f.default ?? ''])));
  return (
    <Stack direction="row" spacing={1} component="form" sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}
      onSubmit={(e) => { e.preventDefault(); onSubmit(v, () => setV(Object.fromEntries(fields.map((f) => [f.name, f.default ?? ''])))); }}>
      {fields.map((f) => (
        <TextField key={f.name} size="small" label={f.label} select={!!f.options} value={v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} sx={{ flex: f.flex ?? 1, minWidth: 110 }}>
          {f.options?.map((o) => <MenuItem key={o} value={o}>{label(o)}</MenuItem>)}
        </TextField>
      ))}
      <Button type="submit" variant="outlined" disabled={busy || !v[fields[0].name]}>Add</Button>
    </Stack>
  );
}

export function useChartMutation(patientId, fn, message) {
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { toast(message); qc.invalidateQueries({ queryKey: ['chart', patientId] }); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
}

export function ClinicalLists({ chart, patientId, canEdit }) {
  const addAllergy = useChartMutation(patientId, (b) => api.patients.addAllergy(patientId, b), 'Allergy recorded');
  const addMed = useChartMutation(patientId, (b) => api.patients.addMedication(patientId, b), 'Medication added');
  const stopMed = useChartMutation(patientId, (id) => api.patients.stopMedication(patientId, id), 'Medication stopped');
  const addCond = useChartMutation(patientId, (b) => api.patients.addCondition(patientId, b), 'Condition added');

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 4 }}>
        <Section title="Allergies">
          {chart.allergies.length ? chart.allergies.map((a) => (
            <Stack key={a.id} direction="row" spacing={1} sx={{ py: 0.75, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
              <Typography sx={{ fontWeight: 600, flex: 1 }}>{a.substance}<Typography component="span" variant="body2" color="text.secondary">{a.reaction ? ` — ${a.reaction}` : ''}</Typography></Typography>
              <StatusChip status={a.severity} />
            </Stack>
          )) : <Typography color="text.secondary">No known allergies</Typography>}
          {canEdit && (
            <QuickAdd busy={addAllergy.isPending}
              fields={[{ name: 'substance', label: 'Substance', flex: 2 }, { name: 'reaction', label: 'Reaction', flex: 2 }, { name: 'severity', label: 'Severity', options: ['mild', 'moderate', 'severe'], default: 'moderate' }]}
              onSubmit={(v, done) => addAllergy.mutate({ ...v, reaction: v.reaction || undefined }, { onSuccess: done })} />
          )}
        </Section>
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <Section title="Current medications">
          {chart.medications.length ? chart.medications.map((m) => (
            <Stack key={m.id} direction="row" sx={{ py: 0.75, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ flex: 1 }}>
                <Typography>{m.name}</Typography>
                <Typography variant="body2" color="text.secondary">{m.dosage || 'No dosage recorded'}, since {date(m.started_on)}</Typography>
              </Box>
              {canEdit && <Button size="small" onClick={() => stopMed.mutate(m.id)}>Stop</Button>}
            </Stack>
          )) : <Typography color="text.secondary">None recorded</Typography>}
          {canEdit && (
            <QuickAdd busy={addMed.isPending} fields={[{ name: 'name', label: 'Medicine', flex: 2 }, { name: 'dosage', label: 'Dosage' }]}
              onSubmit={(v, done) => addMed.mutate({ name: v.name, dosage: v.dosage || undefined }, { onSuccess: done })} />
          )}
        </Section>
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}>
        <Section title="Conditions">
          {chart.conditions.length ? chart.conditions.map((c) => (
            <Box key={c.id} sx={{ py: 0.75, borderBottom: 1, borderColor: 'divider', opacity: c.resolved_on ? 0.6 : 1 }}>
              <Typography>{c.description} {c.icd10_code && <Chip size="small" label={c.icd10_code} variant="outlined" sx={{ ml: 0.5 }} />}</Typography>
              <Typography variant="body2" color="text.secondary">{c.is_chronic ? 'Chronic' : 'Acute'}{c.onset_date ? `, since ${date(c.onset_date)}` : ''}{c.resolved_on ? `, resolved ${date(c.resolved_on)}` : ''}</Typography>
            </Box>
          )) : <Typography color="text.secondary">None recorded</Typography>}
          {canEdit === 'doctor' && (
            <QuickAdd busy={addCond.isPending} fields={[{ name: 'description', label: 'Condition', flex: 2 }, { name: 'icd10Code', label: 'ICD-10' }]}
              onSubmit={(v, done) => addCond.mutate({ description: v.description, icd10Code: v.icd10Code ? v.icd10Code.toUpperCase() : undefined }, { onSuccess: done })} />
          )}
        </Section>
      </Grid>
    </Grid>
  );
}

export function EncounterHistory({ encounters }) {
  if (!encounters.length) return <Typography color="text.secondary">No consultation notes yet.</Typography>;
  return encounters.map((e) => (
    <Box key={e.id} sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 600 }}>{e.chief_complaint || 'Consultation'}</Typography>
        <Typography variant="body2" color="text.secondary">{dateTime(e.created_at)}, Dr. {e.doctor_name}</Typography>
      </Stack>
      {e.vitals && Object.keys(e.vitals).length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {Object.entries(e.vitals).map(([k, v]) => `${{ bp: 'BP', hr: 'HR', rr: 'RR', temp: 'Temp', spo2: 'SpO₂', weightKg: 'Wt', heightCm: 'Ht' }[k] ?? k} ${v}`).join('   ')}
        </Typography>
      )}
      {e.notes && <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{e.notes}</Typography>}
      <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap' }}>
        {(e.diagnoses ?? []).map((d) => <Chip key={d} size="small" label={d} />)}
        {e.follow_up_on && <Chip size="small" variant="outlined" label={`Follow-up ${date(e.follow_up_on)}`} />}
      </Stack>
    </Box>
  ));
}

export function LabHistory({ orders }) {
  if (!orders.length) return <Typography color="text.secondary">No lab orders yet.</Typography>;
  return orders.map((o) => (
    <Box key={o.id} sx={{ py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography sx={{ fontWeight: 600, flex: 1 }}>Ordered {dateTime(o.ordered_at)}</Typography>
        <StatusChip status={o.priority} /><StatusChip status={o.status} />
      </Stack>
      {o.items.map((i) => (
        <Stack key={i.test} direction="row" sx={{ justifyContent: 'space-between', py: 0.25 }}>
          <Typography variant="body2">{i.test}</Typography>
          <Typography variant="body2" sx={{ color: i.flag ? 'error.main' : 'text.primary', fontWeight: i.flag ? 700 : 400 }}>
            {i.value ? `${i.value} ${i.unit ?? ''} ${i.flag ? `(${i.flag})` : ''}` : label(i.status)}
            {i.range && <Typography component="span" variant="body2" color="text.secondary"> ref {i.range}</Typography>}
          </Typography>
        </Stack>
      ))}
    </Box>
  ));
}

export default function PatientChart() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const appointmentId = params.get('appointment') ?? undefined;
  const [tab, setTab] = useState('summary');
  const [dialog, setDialog] = useState(null); // 'rx' | 'lab' | 'invoice'
  const chart = useQuery({ queryKey: ['chart', id], queryFn: () => api.patients.chart(id) });

  return (
    <QueryState query={chart}>
      {(c) => (
        <>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2, justifyContent: 'space-between', alignItems: { md: 'flex-end' } }}>
            <Box>
              <Typography variant="h1">{c.patient.last_name}, {c.patient.first_name}</Typography>
              <Typography color="text.secondary">
                {c.patient.mrn}, {c.patient.age} years, {label(c.patient.sex)}{c.patient.blood_type ? `, blood type ${c.patient.blood_type}` : ''}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Button variant="contained" onClick={() => setDialog('rx')}>Write prescription</Button>
              <Button variant="outlined" onClick={() => setDialog('lab')}>Order labs</Button>
              <Button variant="outlined" onClick={() => setDialog('invoice')}>Create invoice</Button>
            </Stack>
          </Stack>

          {/* Allergy banner is always visible: the single most important safety fact on the chart */}
          {c.allergies.length > 0 ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              <strong>Allergies:</strong> {c.allergies.map((a) => `${a.substance} (${a.severity})`).join(', ')}
            </Alert>
          ) : <Alert severity="info" sx={{ mb: 2 }}>No known allergies recorded.</Alert>}

          <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable">
            <Tab value="summary" label="Summary" />
            <Tab value="note" label="New consultation note" />
            <Tab value="history" label={`Visits (${c.encounters.length})`} />
            <Tab value="rx" label={`Prescriptions (${c.prescriptions.length})`} />
            <Tab value="labs" label={`Labs (${c.labOrders.length})`} />
          </Tabs>

          {tab === 'summary' && <ClinicalLists chart={c} patientId={id} canEdit="doctor" />}
          {tab === 'note' && <Section title="Consultation note"><EncounterForm patientId={id} appointmentId={appointmentId} onSaved={() => setTab('history')} /></Section>}
          {tab === 'history' && <Section title="Visit history"><EncounterHistory encounters={c.encounters} /></Section>}
          {tab === 'rx' && (
            <Section title="Prescriptions">
              {c.prescriptions.length ? (
                <List disablePadding>
                  {c.prescriptions.map((r) => (
                    <ListItem key={r.id} divider secondaryAction={<Button component={RouterLink} to={`/prescriptions/${r.id}`}>Open</Button>}>
                      <ListItemText primary={`${r.rx_no}, ${date(r.issued_at)}`} secondary={(r.items ?? []).map((i) => `${i.name} ${i.dose} ${i.frequency}`).join('; ')} />
                      <StatusChip status={r.status} />
                    </ListItem>
                  ))}
                </List>
              ) : <Typography color="text.secondary">No prescriptions yet.</Typography>}
            </Section>
          )}
          {tab === 'labs' && <Section title="Lab orders"><LabHistory orders={c.labOrders} /></Section>}

          <PrescriptionDialog open={dialog === 'rx'} onClose={() => setDialog(null)} patientId={id} />
          <LabOrderDialog open={dialog === 'lab'} onClose={() => setDialog(null)} patientId={id} />
          <InvoiceDialog open={dialog === 'invoice'} onClose={() => setDialog(null)} patient={c.patient}
            defaultLines={[{ itemType: 'consultation', description: 'Professional fee, consultation', quantity: 1, unitPrice: '' }]} />
        </>
      )}
    </QueryState>
  );
}
