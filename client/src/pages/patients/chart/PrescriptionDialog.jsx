import AddOutlined from '@mui/icons-material/AddOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/endpoints.js';
import { errorMessage } from '../../../api/http.js';
import { useToast } from '../../../components/Toast.jsx';
import { useDebounced } from '../../../hooks/useDebounced.js';
import SafetyAlerts, { BLOCKING } from './SafetyAlerts.jsx';

const newItem = () => ({ key: crypto.randomUUID(), drug: null, dose: '', frequency: '', durationDays: 7, quantity: 1, instructions: '' });
const FREQUENCIES = ['once daily', 'twice daily', 'three times daily', 'every 6 hours', 'every 8 hours', 'at bedtime', 'as needed'];

function DrugField({ value, onChange }) {
  const [input, setInput] = useState('');
  const q = useDebounced(input, 250);
  const drugs = useQuery({ queryKey: ['drugs', q], queryFn: () => api.rx.drugs(q || undefined), staleTime: 10 * 60_000 });
  return (
    <Autocomplete
      options={drugs.data ?? []} value={value} onChange={(_e, v) => onChange(v)} onInputChange={(_e, v) => setInput(v)}
      filterOptions={(x) => x} isOptionEqualToValue={(a, b) => a.id === b.id}
      getOptionLabel={(d) => `${d.generic_name} ${d.strength} ${d.form}${d.brand_name ? ` (${d.brand_name})` : ''}`}
      renderInput={(p) => <TextField {...p} label="Medicine" size="small" />}
      sx={{ flex: 2, minWidth: 240 }}
    />
  );
}

/**
 * Compose → live safety check (dry run) → sign.
 * Blocking alerts need a documented override reason; the server re-checks at signing,
 * so a stale client can never slip an unsafe prescription through.
 */
export default function PrescriptionDialog({ open, onClose, patientId, encounterId }) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [items, setItems] = useState([newItem()]);
  const [pharmacyId, setPharmacyId] = useState('');
  const [notes, setNotes] = useState('');
  const [override, setOverride] = useState('');
  const pharmacies = useQuery({ queryKey: ['pharmacies'], queryFn: api.rx.pharmacies, enabled: open, staleTime: 10 * 60_000 });

  const drugIds = useMemo(() => items.map((i) => i.drug?.id).filter(Boolean), [items]);
  const debouncedIds = useDebounced(drugIds.join(','), 300);
  const check = useQuery({
    queryKey: ['rx-check', patientId, debouncedIds],
    queryFn: () => api.rx.check({ patientId, drugIds: debouncedIds.split(',') }),
    enabled: open && !!debouncedIds,
  });
  const alerts = check.data?.alerts ?? [];
  const blocking = alerts.some((a) => BLOCKING.has(a.severity));

  const update = (key, patch) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const reset = () => { setItems([newItem()]); setPharmacyId(''); setNotes(''); setOverride(''); };

  const sign = useMutation({
    mutationFn: () => api.rx.create({
      patientId, encounterId, pharmacyId: pharmacyId || undefined, notes: notes || undefined,
      overrideReason: blocking ? override : undefined,
      items: items.filter((i) => i.drug).map((i) => ({
        drugId: i.drug.id, dose: i.dose, frequency: i.frequency, durationDays: Number(i.durationDays) || undefined,
        quantity: Number(i.quantity), instructions: i.instructions || undefined,
      })),
    }),
    onSuccess: (rx) => {
      toast(`Prescription ${rx.rx_no} signed${pharmacyId ? ' and sent to the pharmacy' : ''}`);
      qc.invalidateQueries({ queryKey: ['chart', patientId] });
      qc.invalidateQueries({ queryKey: ['prescriptions'] });
      reset();
      onClose();
      navigate(`/prescriptions/${rx.id}`);
    },
    onError: () => check.refetch(), // a 409 means alerts changed server-side: show the fresh list
  });

  const complete = items.some((i) => i.drug) && items.every((i) => !i.drug || (i.dose && i.frequency && Number(i.quantity) > 0));
  const canSign = complete && (!blocking || override.trim().length >= 10) && !sign.isPending;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Write prescription</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {items.map((it, idx) => (
            <Box key={it.key}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1.5, alignItems: 'center' }}>
                <DrugField value={it.drug} onChange={(drug) => update(it.key, { drug })} />
                <TextField size="small" label="Dose" placeholder="1 tablet" value={it.dose} onChange={(e) => update(it.key, { dose: e.target.value })} sx={{ flex: 1, minWidth: 110 }} />
                <TextField size="small" select label="Frequency" value={it.frequency} onChange={(e) => update(it.key, { frequency: e.target.value })} sx={{ flex: 1, minWidth: 160 }}>
                  {FREQUENCIES.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
                </TextField>
                <TextField size="small" type="number" label="Days" value={it.durationDays} onChange={(e) => update(it.key, { durationDays: e.target.value })} sx={{ width: 80 }} />
                <TextField size="small" type="number" label="Qty" value={it.quantity} onChange={(e) => update(it.key, { quantity: e.target.value })} sx={{ width: 80 }} />
                <IconButton aria-label="Remove medicine" disabled={items.length === 1} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}><DeleteOutline /></IconButton>
              </Stack>
              <TextField size="small" fullWidth label="Instructions for the patient" placeholder="Take after meals" value={it.instructions} onChange={(e) => update(it.key, { instructions: e.target.value })} sx={{ mt: 1.5 }} />
              {idx < items.length - 1 && <Divider sx={{ mt: 2 }} />}
            </Box>
          ))}
          <Box><Button startIcon={<AddOutlined />} onClick={() => setItems((xs) => [...xs, newItem()])} disabled={items.length >= 20}>Add medicine</Button></Box>

          {check.isFetching && <Typography variant="body2" color="text.secondary">Checking allergies and interactions…</Typography>}
          {!check.isFetching && drugIds.length > 0 && alerts.length === 0 && <Alert severity="success">No allergy, duplicate or interaction alerts for this patient.</Alert>}
          <SafetyAlerts alerts={alerts} />
          {blocking && (
            <TextField
              label="Override reason (required to sign)" multiline minRows={2} value={override} onChange={(e) => setOverride(e.target.value)}
              helperText="Document the clinical justification. This is stored with the prescription and audit log." error={override.length > 0 && override.trim().length < 10}
            />
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Send to pharmacy" value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)} sx={{ flex: 1 }}>
              <MenuItem value="">Patient will bring the printed prescription</MenuItem>
              {(pharmacies.data ?? []).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </TextField>
            <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} sx={{ flex: 1 }} />
          </Stack>
          {sign.isError && <Alert severity="error">{errorMessage(sign.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={!canSign} onClick={() => sign.mutate()}>{sign.isPending ? 'Signing…' : 'Sign prescription'}</Button>
      </DialogActions>
    </Dialog>
  );
}
