import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, List, ListItem, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../api/endpoints.js';
import { errorMessage } from '../../../api/http.js';
import { useToast } from '../../../components/Toast.jsx';
import { peso } from '../../../utils/format.js';

export default function LabOrderDialog({ open, onClose, patientId, encounterId }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(new Set());
  const [priority, setPriority] = useState('routine');
  const [notes, setNotes] = useState('');
  const tests = useQuery({ queryKey: ['lab-tests'], queryFn: api.labs.tests, enabled: open, staleTime: 30 * 60_000 });

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const total = (tests.data ?? []).filter((t) => selected.has(t.id)).reduce((s, t) => s + Number(t.price), 0);

  const order = useMutation({
    mutationFn: () => api.labs.order({ patientId, encounterId, priority, clinicalNotes: notes || undefined, testIds: [...selected] }),
    onSuccess: () => {
      toast('Lab order sent');
      qc.invalidateQueries({ queryKey: ['chart', patientId] });
      qc.invalidateQueries({ queryKey: ['labs'] });
      setSelected(new Set()); setNotes(''); setPriority('routine');
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Order lab tests</DialogTitle>
      <DialogContent dividers>
        <List dense disablePadding>
          {(tests.data ?? []).map((t) => (
            <ListItem key={t.id} disableGutters secondaryAction={<Typography variant="body2">{peso(t.price)}</Typography>}>
              <FormControlLabel
                control={<Checkbox checked={selected.has(t.id)} onChange={() => toggle(t.id)} />}
                label={<>{t.name} <Typography component="span" variant="body2" color="text.secondary">{t.specimen}, about {t.turnaround_hours}h</Typography></>}
              />
            </ListItem>
          ))}
        </List>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
          <TextField select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="routine">Routine</MenuItem><MenuItem value="urgent">Urgent</MenuItem><MenuItem value="stat">STAT</MenuItem>
          </TextField>
          <TextField label="Clinical notes for the lab" fullWidth value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Stack>
        {order.isError && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(order.error)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Typography sx={{ mr: 'auto', pl: 2 }} color="text.secondary">{selected.size} selected, {peso(total)}</Typography>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={!selected.size || order.isPending} onClick={() => order.mutate()}>Send order</Button>
      </DialogActions>
    </Dialog>
  );
}
