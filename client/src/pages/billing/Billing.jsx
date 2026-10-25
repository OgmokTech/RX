import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, MenuItem, Pagination, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable, PageHeader, QueryState, StatusChip } from '../../components/common.jsx';
import PatientPicker from '../../components/PatientPicker.jsx';
import { useToast } from '../../components/Toast.jsx';
import { date, dateTime, label, peso } from '../../utils/format.js';
import InvoiceDialog from './InvoiceDialog.jsx';

const ONLINE = [['gcash', 'GCash'], ['maya', 'Maya'], ['card', 'Credit or debit card']];
const COUNTER = [['cash', 'Cash'], ['card', 'Card (terminal)'], ['gcash', 'GCash'], ['maya', 'Maya'], ['bank_transfer', 'Bank transfer']];

function PaymentForm({ invoice, isPatient }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(String(invoice.balance));
  const [method, setMethod] = useState(isPatient ? 'gcash' : 'cash');
  const [reference, setReference] = useState('');
  const pay = useMutation({
    // A fresh Idempotency-Key per click (see endpoints.js) → network retries can't double-charge
    mutationFn: () => api.billing.pay(invoice.id, { amount: Number(amount), method, reference: reference || undefined }),
    onSuccess: (p) => {
      toast(p.status === 'succeeded' ? `Payment of ${peso(p.amount)} received` : `Payment ${p.status}`, p.status === 'succeeded' ? 'success' : 'warning');
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice', invoice.id] });
    },
  });
  const amt = Number(amount);
  const valid = amt > 0 && amt <= Number(invoice.balance) && (method === 'cash' || isPatient || reference.trim());

  return (
    <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
      <Typography variant="h3" sx={{ mb: 1.5 }}>{isPatient ? 'Pay online' : 'Record a payment'}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField select label="Method" value={method} onChange={(e) => setMethod(e.target.value)} sx={{ minWidth: 180 }}>
          {(isPatient ? ONLINE : COUNTER).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
        </TextField>
        <TextField type="number" label="Amount (₱)" value={amount} onChange={(e) => setAmount(e.target.value)} error={amt > Number(invoice.balance)}
          helperText={amt > Number(invoice.balance) ? 'More than the balance' : undefined} />
        {!isPatient && method !== 'cash' && <TextField label="Reference no." value={reference} onChange={(e) => setReference(e.target.value)} />}
        <Button variant="contained" disabled={!valid || pay.isPending} onClick={() => pay.mutate()} sx={{ whiteSpace: 'nowrap', minWidth: 120 }}>
          {pay.isPending ? 'Processing…' : `Pay ${peso(amt || 0)}`}
        </Button>
      </Stack>
      {isPatient && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Development build: payments go through a mock gateway. No real money moves.</Typography>}
      {pay.isError && <Alert severity="error" sx={{ mt: 1.5 }}>{errorMessage(pay.error)}</Alert>}
    </Box>
  );
}

function ClaimForm({ invoice }) {
  const toast = useToast();
  const qc = useQueryClient();
  const policies = useQuery({ queryKey: ['policies', invoice.patient_id], queryFn: () => api.patients.policies(invoice.patient_id) });
  const [policyId, setPolicyId] = useState('');
  const [amount, setAmount] = useState('');
  const [claim, setClaim] = useState(null);
  const [approved, setApproved] = useState('');
  const file = useMutation({
    mutationFn: () => api.billing.claim(invoice.id, { policyId, amountClaimed: Number(amount) }),
    onSuccess: (c) => { setClaim(c); setApproved(String(c.amount_claimed)); toast('Claim submitted'); },
  });
  const decide = useMutation({
    mutationFn: (status) => api.billing.decideClaim(claim.id, { status, amountApproved: status === 'denied' ? undefined : Number(approved) }),
    onSuccess: (c) => {
      toast(`Claim ${label(c.status).toLowerCase()}`);
      setClaim(c);
      qc.invalidateQueries({ queryKey: ['invoice', invoice.id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });

  if (!policies.data?.length) return <Typography variant="body2" color="text.secondary">No insurance on file for this patient. Add a PhilHealth or HMO card from the Patients page.</Typography>;
  if (claim) {
    return (
      <Stack spacing={1}>
        <Typography>Claim for {peso(claim.amount_claimed)}: <strong>{label(claim.status)}</strong></Typography>
        {claim.status === 'submitted' && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField type="number" label="Approved amount (₱)" value={approved} onChange={(e) => setApproved(e.target.value)} sx={{ maxWidth: 200 }} />
            <Button variant="outlined" onClick={() => decide.mutate(Number(approved) < Number(claim.amount_claimed) ? 'partially_approved' : 'approved')}>Record approval</Button>
            <Button color="error" onClick={() => decide.mutate('denied')}>Denied</Button>
          </Stack>
        )}
        {decide.isError && <Alert severity="error">{errorMessage(decide.error)}</Alert>}
      </Stack>
    );
  }
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
      <TextField select label="Policy" value={policyId} onChange={(e) => setPolicyId(e.target.value)} sx={{ minWidth: 220 }}>
        {policies.data.map((p) => <MenuItem key={p.id} value={p.id}>{p.provider}, ending {p.member_no_last4}</MenuItem>)}
      </TextField>
      <TextField type="number" label="Amount to claim (₱)" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button variant="outlined" disabled={!policyId || !(Number(amount) > 0) || file.isPending} onClick={() => file.mutate()}>Submit claim</Button>
      {file.isError && <Alert severity="error">{errorMessage(file.error)}</Alert>}
    </Stack>
  );
}

function InvoiceDetail({ id, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api.billing.get(id), enabled: !!id });
  const voidInv = useMutation({
    mutationFn: () => api.billing.void(id),
    onSuccess: () => { toast('Invoice voided'); qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['invoice', id] }); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const isPatient = user.role === 'patient';
  const isFrontDesk = ['admin', 'receptionist'].includes(user.role);

  return (
    <Dialog open={!!id} onClose={onClose} fullWidth maxWidth="md">
      <QueryState query={q}>
        {(inv) => {
          const open = ['issued', 'partially_paid'].includes(inv.status);
          return (
            <>
              <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Invoice {inv.invoice_no}</span><StatusChip status={inv.status} size="medium" />
              </DialogTitle>
              <DialogContent dividers>
                <Typography color="text.secondary" sx={{ mb: 2 }}>{inv.patient_name} ({inv.mrn}), issued {date(inv.issued_at)}, due {date(inv.due_date)}</Typography>
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead><TableRow><TableCell>Item</TableCell><TableCell align="right">Qty</TableCell><TableCell align="right">Unit price</TableCell><TableCell align="right">Amount</TableCell></TableRow></TableHead>
                    <TableBody>
                      {inv.items.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.description}<Typography variant="body2" color="text.secondary">{label(i.item_type)}</Typography></TableCell>
                          <TableCell align="right">{Number(i.quantity)}</TableCell>
                          <TableCell align="right">{peso(i.unit_price)}</TableCell>
                          <TableCell align="right">{peso(i.line_total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
                <Box sx={{ ml: 'auto', mt: 2, maxWidth: 300 }}>
                  {[
                    ['Subtotal', inv.subtotal],
                    [`Discount${inv.discount_type !== 'none' ? ` (${inv.discount_type === 'pwd' ? 'PWD' : label(inv.discount_type)})` : ''}`, -inv.discount],
                    ['VAT', inv.tax], ['Total', inv.total], ['Paid', -inv.amount_paid],
                  ].map(([k, v]) => (
                    <Stack key={k} direction="row" sx={{ justifyContent: 'space-between' }}><Typography color="text.secondary">{k}</Typography><Typography>{peso(v)}</Typography></Stack>
                  ))}
                  <Stack direction="row" sx={{ justifyContent: 'space-between', borderTop: 1, borderColor: 'divider', mt: 0.5, pt: 0.5 }}>
                    <Typography sx={{ fontWeight: 700 }}>Balance</Typography><Typography sx={{ fontWeight: 700 }}>{peso(inv.balance)}</Typography>
                  </Stack>
                </Box>

                {inv.payments.length > 0 && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="h3" sx={{ mb: 1 }}>Payments</Typography>
                    {inv.payments.map((p) => (
                      <Stack key={p.id} direction="row" spacing={2} sx={{ py: 0.5 }}>
                        <Typography sx={{ flex: 1 }}>{dateTime(p.paid_at)}, {label(p.method)}{p.reference ? ` (${p.reference})` : ''}</Typography>
                        <Typography>{peso(p.amount)}</Typography>
                        <StatusChip status={p.status === 'succeeded' ? 'paid' : p.status} />
                      </Stack>
                    ))}
                  </>
                )}
                {open && (isPatient || isFrontDesk) && <Box sx={{ mt: 2 }}><PaymentForm invoice={inv} isPatient={isPatient} /></Box>}
                {open && isFrontDesk && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="h3" sx={{ mb: 1 }}>Insurance or HMO claim</Typography>
                    <ClaimForm invoice={inv} />
                  </Box>
                )}
              </DialogContent>
              <DialogActions>
                {user.role === 'admin' && inv.status === 'issued' && Number(inv.amount_paid) === 0 && (
                  <Button color="error" onClick={() => voidInv.mutate()} sx={{ mr: 'auto' }}>Void invoice</Button>
                )}
                <Button onClick={onClose}>Close</Button>
              </DialogActions>
            </>
          );
        }}
      </QueryState>
    </Dialog>
  );
}

export default function Billing() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [patient, setPatient] = useState(null);
  const patientId = params.get('patient') ?? undefined;
  const isPatient = user.role === 'patient';

  const q = useQuery({
    queryKey: ['invoices', status, page, patientId],
    queryFn: () => api.billing.list({ status, page, pageSize: 20, patientId }),
    placeholderData: (p) => p,
  });

  return (
    <>
      <PageHeader
        title={isPatient ? 'Bills and payments' : 'Billing'}
        subtitle={isPatient ? 'Pay with GCash, Maya or card. Senior citizen and PWD discounts are applied at the counter.' : undefined}
        actions={!isPatient && (
          <>
            {patientId && <Button onClick={() => setParams({})}>Show all patients</Button>}
            <Button variant="contained" onClick={() => setCreating(true)}>New invoice</Button>
          </>
        )}
      />
      <Tabs value={status} onChange={(_e, v) => { setStatus(v); setPage(1); }} sx={{ mb: 2 }}>
        <Tab value="open" label="Unpaid" /><Tab value="paid" label="Paid" /><Tab value="all" label="All" />
      </Tabs>
      <QueryState query={q} empty={{ title: status === 'open' ? 'Nothing to pay' : 'No invoices', body: status === 'open' && isPatient ? 'You are all settled.' : undefined }}>
        {(d) => (
          <>
            <DataTable
              rows={d.data}
              onRowClick={(r) => setOpenId(r.id)}
              columns={[
                { key: 'invoice_no', header: 'Invoice', render: (r) => <Typography sx={{ fontWeight: 600 }}>{r.invoice_no}</Typography> },
                !isPatient && { key: 'patient_name', header: 'Patient', render: (r) => <>{r.patient_name}<Typography variant="body2" color="text.secondary">{r.mrn}</Typography></> },
                { key: 'issued_at', header: 'Issued', render: (r) => date(r.issued_at) },
                { key: 'due_date', header: 'Due', render: (r) => date(r.due_date) },
                { key: 'total', header: 'Total', align: 'right', render: (r) => peso(r.total) },
                { key: 'balance', header: 'Balance', align: 'right', render: (r) => <Typography sx={{ fontWeight: Number(r.balance) ? 700 : 400 }}>{peso(r.balance)}</Typography> },
                { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
              ].filter(Boolean)}
            />
            {d.meta.total > 20 && <Pagination sx={{ mt: 2 }} count={Math.ceil(d.meta.total / 20)} page={page} onChange={(_e, p) => setPage(p)} />}
          </>
        )}
      </QueryState>

      <InvoiceDetail id={openId} onClose={() => setOpenId(null)} />

      {creating && !patient && (
        <Dialog open onClose={() => setCreating(false)} fullWidth maxWidth="sm">
          <DialogTitle>Who is this invoice for?</DialogTitle>
          <DialogContent sx={{ pt: '8px !important' }}><PatientPicker value={patient} onChange={setPatient} /></DialogContent>
          <DialogActions><Button onClick={() => setCreating(false)}>Close</Button></DialogActions>
        </Dialog>
      )}
      <InvoiceDialog
        open={creating && !!patient} patient={patient}
        onClose={(inv) => { setCreating(false); setPatient(null); if (inv) setOpenId(inv.id); }}
      />
    </>
  );
}
