import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, InputAdornment, List, ListItem, ListItemText, MenuItem, Pagination, Stack, Switch, TextField, Typography } from '@mui/material';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/endpoints.js';
import { errorMessage, fieldErrors } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable, PageHeader, QueryState } from '../../components/common.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useDebounced } from '../../hooks/useDebounced.js';
import { date, dateTime, label, peso } from '../../utils/format.js';

const MOVES = { restock: 'Restock (+)', return: 'Return (+)', dispense: 'Dispense (−)', expired: 'Expired (−)', adjustment: 'Count adjustment (±)' };
const EMPTY = { sku: '', name: '', category: 'supply', unit: 'pc', reorderLevel: 10, unitCost: 0, expiryDate: '', initialQuantity: 0 };

function NewItemDialog({ open, onClose }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const create = useMutation({
    mutationFn: () => api.inventory.create({ ...f, reorderLevel: Number(f.reorderLevel), unitCost: Number(f.unitCost), initialQuantity: Number(f.initialQuantity), expiryDate: f.expiryDate || null }),
    onSuccess: () => { toast('Item added'); qc.invalidateQueries({ queryKey: ['inventory'] }); setF(EMPTY); onClose(); },
  });
  const errs = fieldErrors(create.error);
  const bind = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }), error: !!errs[k], helperText: errs[k]?.[0] });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add inventory item</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid size={4}><TextField label="SKU" {...bind('sku')} /></Grid>
          <Grid size={8}><TextField label="Name" {...bind('name')} /></Grid>
          <Grid size={6}>
            <TextField select label="Category" {...bind('category')}>
              {['medicine', 'supply', 'equipment', 'reagent'].map((c) => <MenuItem key={c} value={c}>{label(c)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={6}><TextField label="Unit" placeholder="pc, box, vial" {...bind('unit')} /></Grid>
          <Grid size={4}><TextField type="number" label="Opening stock" {...bind('initialQuantity')} /></Grid>
          <Grid size={4}><TextField type="number" label="Reorder level" {...bind('reorderLevel')} /></Grid>
          <Grid size={4}><TextField type="number" label="Unit cost (₱)" {...bind('unitCost')} /></Grid>
          <Grid size={6}><TextField type="date" label="Expiry date" slotProps={{ inputLabel: { shrink: true } }} {...bind('expiryDate')} /></Grid>
        </Grid>
        {create.isError && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(create.error)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={!f.sku || !f.name || create.isPending} onClick={() => create.mutate()}>Add item</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Every stock change is a ledger row; a DB trigger applies it and refuses to go below zero. */
function StockDialog({ item, onClose, canManage }) {
  // Doctors may dispense from clinic stock; restocking and adjustments are front-desk duties
  const reasons = canManage ? ['restock', 'return', 'dispense', 'expired', 'adjustment'] : ['dispense'];
  const toast = useToast();
  const qc = useQueryClient();
  const [change, setChange] = useState('');
  const [reason, setReason] = useState(canManage ? 'restock' : 'dispense');
  const [reference, setReference] = useState('');
  const history = useQuery({ queryKey: ['inventory-history', item?.id], queryFn: () => api.inventory.history(item.id), enabled: !!item });
  const move = useMutation({
    mutationFn: () => {
      const n = Math.abs(Number(change));
      const signed = ['restock', 'return'].includes(reason) ? n : reason === 'adjustment' ? Number(change) : -n;
      return api.inventory.move(item.id, { change: signed, reason, reference: reference || undefined });
    },
    onSuccess: () => {
      toast('Stock updated');
      setChange(''); setReference('');
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-history', item.id] });
      onClose();
    },
  });
  if (!item) return null;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{item.name}</DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ mb: 2 }}>On hand: <strong>{item.quantity_on_hand} {item.unit}</strong>, reorder at {item.reorder_level}</Typography>
        {(
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
            <TextField select label="Movement" value={reason} onChange={(e) => setReason(e.target.value)} sx={{ minWidth: 160 }}>
              {reasons.map((r) => <MenuItem key={r} value={r}>{MOVES[r]}</MenuItem>)}
            </TextField>
            <TextField type="number" label={reason === 'adjustment' ? 'Change (+/−)' : 'Quantity'} value={change} onChange={(e) => setChange(e.target.value)} />
            <TextField label="Reference" placeholder="DR no., PO no." value={reference} onChange={(e) => setReference(e.target.value)} />
          </Stack>
        )}
        {move.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(move.error)}</Alert>}
        <Typography variant="h3">Recent movements</Typography>
        <List dense>
          {(history.data ?? []).map((t) => (
            <ListItem key={t.id} disableGutters divider secondaryAction={<Typography sx={{ fontWeight: 600, color: t.change > 0 ? 'success.main' : 'error.main' }}>{t.change > 0 ? `+${t.change}` : t.change}</Typography>}>
              <ListItemText primary={`${label(t.reason)}${t.reference ? `, ${t.reference}` : ''}`} secondary={`${dateTime(t.created_at)}, ${t.created_by ?? 'system'}`} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {<Button variant="contained" disabled={!Number(change) || move.isPending} onClick={() => move.mutate()}>Save movement</Button>}
      </DialogActions>
    </Dialog>
  );
}

export default function Inventory() {
  const { user } = useAuth();
  const canManage = ['admin', 'receptionist'].includes(user.role);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(null);
  const term = useDebounced(search.trim(), 300);
  const q = useQuery({
    queryKey: ['inventory', term, lowOnly, page],
    queryFn: () => api.inventory.list({ search: term || undefined, lowStock: lowOnly ? 'true' : undefined, page, pageSize: 25 }),
    placeholderData: (p) => p,
  });

  return (
    <>
      <PageHeader title="Inventory" subtitle="Medicines, supplies and equipment" actions={canManage && <Button variant="contained" onClick={() => setAdding(true)}>Add item</Button>} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <TextField placeholder="Search by name or SKU" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} sx={{ maxWidth: 380 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchOutlined /></InputAdornment> } }} />
        <FormControlLabel control={<Switch checked={lowOnly} onChange={(e) => { setLowOnly(e.target.checked); setPage(1); }} />} label="At or below reorder level" />
      </Stack>
      <QueryState query={q} empty={{ title: lowOnly ? 'Nothing needs restocking' : 'No items found' }}>
        {(d) => (
          <>
            <DataTable
              rows={d.data}
              onRowClick={setSelected}
              columns={[
                { key: 'sku', header: 'SKU' },
                { key: 'name', header: 'Item', render: (i) => <>{i.name}<Typography variant="body2" color="text.secondary">{label(i.category)}</Typography></> },
                {
                  key: 'qty', header: 'On hand', align: 'right',
                  render: (i) => <Typography sx={{ fontWeight: 600, color: i.is_low ? 'error.main' : 'text.primary' }}>{i.quantity_on_hand} {i.unit}</Typography>,
                },
                { key: 'reorder_level', header: 'Reorder at', align: 'right' },
                { key: 'unit_cost', header: 'Unit cost', align: 'right', render: (i) => peso(i.unit_cost) },
                {
                  key: 'expiry', header: 'Expiry',
                  render: (i) => <Box component="span" sx={{ color: i.expiring_soon ? 'warning.main' : 'inherit', fontWeight: i.expiring_soon ? 600 : 400 }}>{date(i.expiry_date)}</Box>,
                },
              ]}
            />
            {d.meta.total > 25 && <Pagination sx={{ mt: 2 }} count={Math.ceil(d.meta.total / 25)} page={page} onChange={(_e, p) => setPage(p)} />}
          </>
        )}
      </QueryState>
      <NewItemDialog open={adding} onClose={() => setAdding(false)} />
      <StockDialog key={selected?.id} item={selected} onClose={() => setSelected(null)} canManage={canManage} />
    </>
  );
}
