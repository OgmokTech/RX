import AddOutlined from '@mui/icons-material/AddOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/http.js';
import { useToast } from '../../components/Toast.jsx';
import { peso } from '../../utils/format.js';

const TYPES = ['consultation', 'procedure', 'lab', 'medication', 'supply', 'other'];
const line = (over = {}) => ({ key: crypto.randomUUID(), itemType: 'consultation', description: '', quantity: 1, unitPrice: '', ...over });

/**
 * Preview mirrors the server's centavo math; the server recomputes and is the source of truth
 * (a client can never set its own total). VAT, if configured, is added by the server.
 */
export default function InvoiceDialog({ open, onClose, patient, defaultLines }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [lines, setLines] = useState(() => defaultLines?.map(line) ?? [line()]);
  const [discountType, setDiscountType] = useState('none');
  const [manual, setManual] = useState('');

  const upd = (key, patch) => setLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const c = (n) => Math.round(Number(n || 0) * 100);
  const subtotal = lines.reduce((s, l) => s + Math.round(c(l.unitPrice) * Number(l.quantity || 0)), 0);
  const discount = ['senior', 'pwd'].includes(discountType) ? Math.round(subtotal * 0.2) : discountType === 'manual' ? Math.min(c(manual), subtotal) : 0;

  const create = useMutation({
    mutationFn: () => api.billing.create({
      patientId: patient.id, discountType,
      manualDiscount: discountType === 'manual' ? Number(manual || 0) : undefined,
      items: lines.map((l) => ({ itemType: l.itemType, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
    }),
    onSuccess: (inv) => {
      toast(`Invoice ${inv.invoice_no} issued for ${peso(inv.total)}`);
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setLines([line()]); setDiscountType('none'); setManual('');
      onClose(inv);
    },
  });
  const valid = lines.every((l) => l.description.trim().length >= 2 && Number(l.quantity) > 0 && l.unitPrice !== '' && Number(l.unitPrice) >= 0);

  return (
    <Dialog open={open} onClose={() => onClose()} fullWidth maxWidth="md">
      <DialogTitle>New invoice{patient ? ` for ${patient.first_name} ${patient.last_name}` : ''}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {lines.map((l) => (
            <Stack key={l.key} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: { xs: 'wrap', sm: 'nowrap' }, rowGap: 1 }}>
              <TextField size="small" select label="Type" value={l.itemType} onChange={(e) => upd(l.key, { itemType: e.target.value })} sx={{ width: 150 }}>
                {TYPES.map((t) => <MenuItem key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Description" value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} sx={{ flex: 1, minWidth: 180 }} />
              <TextField size="small" type="number" label="Qty" value={l.quantity} onChange={(e) => upd(l.key, { quantity: e.target.value })} sx={{ width: 80 }} />
              <TextField size="small" type="number" label="Unit price (₱)" value={l.unitPrice} onChange={(e) => upd(l.key, { unitPrice: e.target.value })} sx={{ width: 140 }} />
              <IconButton aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((xs) => xs.filter((x) => x.key !== l.key))}><DeleteOutline /></IconButton>
            </Stack>
          ))}
          <Box><Button startIcon={<AddOutlined />} onClick={() => setLines((xs) => [...xs, line({ itemType: 'other' })])}>Add line</Button></Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Discount" value={discountType} onChange={(e) => setDiscountType(e.target.value)} sx={{ minWidth: 260 }}
              helperText={['senior', 'pwd'].includes(discountType) ? 'Verify the ID at the counter. 20% off, VAT-exempt.' : undefined}>
              <MenuItem value="none">None</MenuItem>
              <MenuItem value="senior">Senior citizen (RA 9994)</MenuItem>
              <MenuItem value="pwd">Person with disability (RA 10754)</MenuItem>
              <MenuItem value="manual">Manual amount</MenuItem>
            </TextField>
            {discountType === 'manual' && <TextField type="number" label="Discount (₱)" value={manual} onChange={(e) => setManual(e.target.value)} />}
          </Stack>
          <Box sx={{ alignSelf: 'flex-end', minWidth: 260 }}>
            {[['Subtotal', subtotal], ['Discount', -discount]].map(([k, v]) => (
              <Stack key={k} direction="row" sx={{ justifyContent: 'space-between' }}><Typography color="text.secondary">{k}</Typography><Typography>{peso(v / 100)}</Typography></Stack>
            ))}
            <Stack direction="row" sx={{ justifyContent: 'space-between', borderTop: 1, borderColor: 'divider', mt: 0.5, pt: 0.5 }}>
              <Typography sx={{ fontWeight: 700 }}>Total</Typography><Typography sx={{ fontWeight: 700 }}>{peso((subtotal - discount) / 100)}</Typography>
            </Stack>
          </Box>
          {create.isError && <Alert severity="error">{errorMessage(create.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()}>Close</Button>
        <Button variant="contained" disabled={!patient || !valid || create.isPending} onClick={() => create.mutate()}>Issue invoice</Button>
      </DialogActions>
    </Dialog>
  );
}
