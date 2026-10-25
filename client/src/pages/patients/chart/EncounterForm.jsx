import { Alert, Box, Button, Grid, Stack, TextField } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../api/endpoints.js';
import { errorMessage, fieldErrors } from '../../../api/http.js';
import { useToast } from '../../../components/Toast.jsx';

const EMPTY = { chiefComplaint: '', notes: '', bp: '', hr: '', rr: '', temp: '', spo2: '', weightKg: '', heightCm: '', diagnoses: '', followUpOn: '' };
const NUMERIC = ['hr', 'rr', 'temp', 'spo2', 'weightKg', 'heightCm'];

/** SOAP-style consultation note. Notes are encrypted at rest (AES-256-GCM) by the API. */
export default function EncounterForm({ patientId, appointmentId, onSaved }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = useMutation({
    mutationFn: () => {
      const vitals = Object.fromEntries(
        ['bp', ...NUMERIC].filter((k) => f[k] !== '').map((k) => [k, NUMERIC.includes(k) ? Number(f[k]) : f[k]])
      );
      return api.encounters.create({
        patientId, appointmentId,
        chiefComplaint: f.chiefComplaint || undefined,
        notes: f.notes || undefined,
        vitals: Object.keys(vitals).length ? vitals : undefined,
        diagnoses: f.diagnoses ? f.diagnoses.split(/[,\s]+/).filter(Boolean).map((c) => c.toUpperCase()) : undefined,
        followUpOn: f.followUpOn || undefined,
      });
    },
    onSuccess: (enc) => {
      toast('Consultation note saved');
      setF(EMPTY);
      qc.invalidateQueries({ queryKey: ['chart', patientId] });
      onSaved?.(enc);
    },
  });
  const errs = fieldErrors(save.error);

  return (
    <Stack spacing={2}>
      <TextField label="Chief complaint" value={f.chiefComplaint} onChange={set('chiefComplaint')} />
      <Grid container spacing={1.5}>
        {[['bp', 'BP (mmHg)', '120/80'], ['hr', 'Heart rate'], ['rr', 'Resp. rate'], ['temp', 'Temp (°C)'], ['spo2', 'SpO₂ (%)'], ['weightKg', 'Weight (kg)'], ['heightCm', 'Height (cm)']].map(([k, l, ph]) => (
          <Grid key={k} size={{ xs: 6, sm: 3, md: 12 / 7 }}>
            <TextField size="small" fullWidth label={l} placeholder={ph} value={f[k]} onChange={set(k)} slotProps={{ htmlInput: { inputMode: k === 'bp' ? 'text' : 'decimal' } }} />
          </Grid>
        ))}
      </Grid>
      <TextField label="Assessment and plan" multiline minRows={5} value={f.notes} onChange={set('notes')} placeholder="History, findings, assessment, plan" />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField label="Diagnoses (ICD-10)" placeholder="J06.9, I10" fullWidth value={f.diagnoses} onChange={set('diagnoses')} error={!!errs.diagnoses} helperText={errs.diagnoses?.[0] ?? 'Separate codes with commas'} />
        <TextField label="Follow-up on" type="date" value={f.followUpOn} onChange={set('followUpOn')} slotProps={{ inputLabel: { shrink: true } }} sx={{ minWidth: 200 }} />
      </Stack>
      {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
      <Box><Button variant="contained" disabled={save.isPending || (!f.notes && !f.chiefComplaint)} onClick={() => save.mutate()}>Save note</Button></Box>
    </Stack>
  );
}
