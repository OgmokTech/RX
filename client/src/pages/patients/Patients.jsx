import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, InputAdornment, MenuItem, Pagination, Stack, TextField, Typography } from '@mui/material';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints.js';
import { errorMessage, fieldErrors } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable, PageHeader, QueryState, Section } from '../../components/common.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useDebounced } from '../../hooks/useDebounced.js';
import { date, label } from '../../utils/format.js';
import InvoiceDialog from '../billing/InvoiceDialog.jsx';
import InsurancePolicies from './InsurancePolicies.jsx';

const EMPTY = { firstName: '', lastName: '', birthDate: '', sex: 'unspecified', phone: '', email: '' };

/** Reception registers walk-in patients who don't have an online account. */
function RegisterDialog({ open, onClose }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const create = useMutation({
    mutationFn: () => api.patients.create({ ...f, phone: f.phone || null, email: f.email || null }),
    onSuccess: (p) => { toast(`Registered ${p.first_name} ${p.last_name} (${p.mrn})`); qc.invalidateQueries({ queryKey: ['patients'] }); setF(EMPTY); onClose(); },
  });
  const errs = fieldErrors(create.error);
  const bind = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }), error: !!errs[k], helperText: errs[k]?.[0] });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Register walk-in patient</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid size={6}><TextField fullWidth label="First name" required {...bind('firstName')} /></Grid>
          <Grid size={6}><TextField fullWidth label="Last name" required {...bind('lastName')} /></Grid>
          <Grid size={6}><TextField fullWidth type="date" label="Birth date" required slotProps={{ inputLabel: { shrink: true } }} {...bind('birthDate')} /></Grid>
          <Grid size={6}>
            <TextField fullWidth select label="Sex" {...bind('sex')}>
              {['female', 'male', 'intersex', 'unspecified'].map((s) => <MenuItem key={s} value={s}>{label(s)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={6}><TextField fullWidth label="Mobile number" {...bind('phone')} /></Grid>
          <Grid size={6}><TextField fullWidth label="Email" {...bind('email')} /></Grid>
        </Grid>
        {create.isError && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(create.error)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={!f.firstName || !f.lastName || !f.birthDate || create.isPending} onClick={() => create.mutate()}>Register</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Front-desk view of one patient: demographics, insurance, billing. No clinical data (RBAC). */
function ProfileDialog({ patient, onClose }) {
  const navigate = useNavigate();
  const [invoicing, setInvoicing] = useState(false);
  if (!patient) return null;
  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{patient.last_name}, {patient.first_name}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography>{patient.mrn}, {patient.age} years, {label(patient.sex)}</Typography>
            <Typography color="text.secondary">Born {date(patient.birth_date)}</Typography>
            <Typography color="text.secondary">{patient.phone || 'No phone'}, {patient.email || 'no email'}</Typography>
          </Stack>
          <Section title="Insurance and HMO" sx={{ p: 0, boxShadow: 'none', border: 0 }}>
            <InsurancePolicies patientId={patient.id} />
          </Section>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => navigate(`/billing?patient=${patient.id}`)}>View invoices</Button>
          <Button onClick={() => setInvoicing(true)}>New invoice</Button>
          <Button variant="contained" onClick={onClose}>Done</Button>
        </DialogActions>
      </Dialog>
      <InvoiceDialog open={invoicing} onClose={() => setInvoicing(false)} patient={patient} />
    </>
  );
}

export default function Patients() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [registering, setRegistering] = useState(false);
  const [selected, setSelected] = useState(null);
  const term = useDebounced(search.trim(), 300);
  const q = useQuery({
    queryKey: ['patients', term, page],
    queryFn: () => api.patients.search({ search: term || undefined, page, pageSize: 25 }),
    placeholderData: (prev) => prev,
  });
  const isDoctor = user.role === 'doctor';

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle={isDoctor ? 'Patients who have booked with you' : 'Search by name, MRN or mobile number'}
        actions={!isDoctor && <Button variant="contained" onClick={() => setRegistering(true)}>Register walk-in</Button>}
      />
      <TextField
        fullWidth placeholder="Search patients" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} sx={{ mb: 2, maxWidth: 480 }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchOutlined /></InputAdornment> } }}
      />
      <QueryState query={q} empty={{ title: 'No patients found', body: term ? 'Try a different spelling or the MRN.' : undefined }}>
        {(d) => (
          <>
            <DataTable
              rows={d.data}
              onRowClick={(p) => (isDoctor ? navigate(`/patients/${p.id}`) : setSelected(p))}
              columns={[
                { key: 'mrn', header: 'MRN' },
                { key: 'name', header: 'Name', render: (p) => `${p.last_name}, ${p.first_name}` },
                { key: 'age', header: 'Age', render: (p) => `${p.age} (${label(p.sex)})` },
                { key: 'phone', header: 'Mobile', render: (p) => p.phone || '—' },
                { key: 'created_at', header: 'Registered', render: (p) => date(p.created_at) },
              ]}
            />
            {d.meta.total > 25 && <Pagination sx={{ mt: 2 }} count={Math.ceil(d.meta.total / 25)} page={page} onChange={(_e, p) => setPage(p)} />}
          </>
        )}
      </QueryState>
      <RegisterDialog open={registering} onClose={() => setRegistering(false)} />
      <ProfileDialog patient={selected} onClose={() => setSelected(null)} />
    </>
  );
}
