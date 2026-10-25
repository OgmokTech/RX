import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Pagination, Stack, Switch, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/endpoints.js';
import { errorMessage, fieldErrors } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable, PageHeader, QueryState } from '../../components/common.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useDebounced } from '../../hooks/useDebounced.js';
import { dateTime, label } from '../../utils/format.js';

const EMPTY = { role: 'doctor', email: '', password: '', firstName: '', lastName: '', specialization: '', licenseNo: '', ptrNo: '', consultationFee: 500, position: '' };

function CreateUserDialog({ open, onClose }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const create = useMutation({
    mutationFn: () => {
      const base = { role: f.role, email: f.email, password: f.password, firstName: f.firstName, lastName: f.lastName };
      return api.admin.createUser(f.role === 'doctor'
        ? { ...base, specialization: f.specialization, licenseNo: f.licenseNo, ptrNo: f.ptrNo || undefined, consultationFee: Number(f.consultationFee) }
        : { ...base, position: f.position });
    },
    onSuccess: () => { toast('Account created. Share the temporary password privately.'); qc.invalidateQueries({ queryKey: ['admin-users'] }); setF(EMPTY); onClose(); },
  });
  const errs = fieldErrors(create.error);
  const bind = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }), error: !!errs[k], helperText: errs[k]?.[0] });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add staff account</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid size={12}>
            <TextField select label="Role" {...bind('role')}>
              <MenuItem value="doctor">Doctor</MenuItem><MenuItem value="receptionist">Receptionist</MenuItem><MenuItem value="admin">Administrator</MenuItem>
            </TextField>
          </Grid>
          <Grid size={6}><TextField label="First name" {...bind('firstName')} /></Grid>
          <Grid size={6}><TextField label="Last name" {...bind('lastName')} /></Grid>
          <Grid size={6}><TextField label="Email" type="email" {...bind('email')} /></Grid>
          <Grid size={6}><TextField label="Temporary password" type="password" autoComplete="new-password" {...bind('password')} /></Grid>
          {f.role === 'doctor' ? (
            <>
              <Grid size={6}><TextField label="Specialization" {...bind('specialization')} /></Grid>
              <Grid size={6}><TextField label="PRC license no." {...bind('licenseNo')} /></Grid>
              <Grid size={6}><TextField label="PTR no." {...bind('ptrNo')} /></Grid>
              <Grid size={6}><TextField type="number" label="Consultation fee (₱)" {...bind('consultationFee')} /></Grid>
            </>
          ) : (
            <Grid size={12}><TextField label="Position" placeholder="Front desk, Billing clerk" {...bind('position')} /></Grid>
          )}
        </Grid>
        {<Alert severity="info" sx={{ mt: 2 }}>Ask the new user to turn on two-factor authentication in Account settings at first sign-in.</Alert>}
        {create.isError && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(create.error)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={create.isPending} onClick={() => create.mutate()}>Create account</Button>
      </DialogActions>
    </Dialog>
  );
}

function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const term = useDebounced(search.trim(), 300);
  const q = useQuery({
    queryKey: ['admin-users', role, term, page],
    queryFn: () => api.admin.users({ role: role || undefined, search: term || undefined, page, pageSize: 25 }),
    placeholderData: (p) => p,
  });
  const setActive = useMutation({
    mutationFn: ({ id, isActive }) => api.admin.setActive(id, isActive),
    onSuccess: (_d, v) => { toast(v.isActive ? 'Account reactivated' : 'Account deactivated and signed out everywhere'); qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField placeholder="Search name or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} sx={{ maxWidth: 320 }} />
        <TextField select label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} sx={{ width: 180 }}>
          <MenuItem value="">All roles</MenuItem>
          {['patient', 'doctor', 'receptionist', 'admin'].map((r) => <MenuItem key={r} value={r}>{label(r)}</MenuItem>)}
        </TextField>
        <Stack sx={{ flex: 1, alignItems: 'flex-end' }}><Button variant="contained" onClick={() => setCreating(true)}>Add staff account</Button></Stack>
      </Stack>
      <QueryState query={q} empty={{ title: 'No users match' }}>
        {(d) => (
          <>
            <DataTable
              rows={d.data}
              columns={[
                { key: 'name', header: 'Name', render: (u) => <>{u.name}<Typography variant="body2" color="text.secondary">{u.email}</Typography></> },
                { key: 'role', header: 'Role', render: (u) => <>{label(u.role)}<Typography variant="body2" color="text.secondary">{u.specialization ?? u.position ?? ''}</Typography></> },
                { key: 'mfa', header: '2FA', render: (u) => (u.mfa_enabled ? 'On' : <Typography component="span" color={u.role === 'patient' ? 'text.secondary' : 'warning.main'}>Off</Typography>) },
                { key: 'last_login_at', header: 'Last sign-in', render: (u) => dateTime(u.last_login_at) },
                {
                  key: 'active', header: 'Active', align: 'right',
                  render: (u) => (
                    <Switch checked={u.is_active} disabled={u.id === me.id || setActive.isPending}
                      onChange={(e) => setActive.mutate({ id: u.id, isActive: e.target.checked })}
                      slotProps={{ input: { 'aria-label': `${u.is_active ? 'Deactivate' : 'Activate'} ${u.name}` } }} />
                  ),
                },
              ]}
            />
            {d.meta.total > 25 && <Pagination sx={{ mt: 2 }} count={Math.ceil(d.meta.total / 25)} page={page} onChange={(_e, p) => setPage(p)} />}
          </>
        )}
      </QueryState>
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function AuditLogs() {
  const [resource, setResource] = useState('');
  const [patientId, setPatientId] = useState('');
  const q = useQuery({
    queryKey: ['audit', resource, patientId],
    queryFn: () => api.admin.auditLogs({ resource: resource || undefined, patientId: patientId.trim() || undefined, limit: 100 }),
  });
  return (
    <>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Who viewed or changed what, and when. Filter by patient ID to answer a data subject access request under RA 10173.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField select label="Resource" value={resource} onChange={(e) => setResource(e.target.value)} sx={{ width: 220 }}>
          <MenuItem value="">All</MenuItem>
          {['patient_chart', 'patient_profile', 'prescription', 'encounter', 'invoice', 'payment', 'appointment', 'user'].map((r) => <MenuItem key={r} value={r}>{label(r)}</MenuItem>)}
        </TextField>
        <TextField label="Patient ID" value={patientId} onChange={(e) => setPatientId(e.target.value)} sx={{ maxWidth: 360 }} />
      </Stack>
      <QueryState query={q} empty={{ title: 'No audit entries' }}>
        {(rows) => (
          <DataTable
            rowKey="_id" rows={rows}
            columns={[
              { key: 'at', header: 'When', render: (r) => dateTime(r.at) },
              { key: 'actor', header: 'Who', render: (r) => <>{r.actor?.name ?? '—'}<Typography variant="body2" color="text.secondary">{label(r.actor?.role)}</Typography></> },
              { key: 'action', header: 'Action', render: (r) => `${label(r.action)} ${label(r.resource).toLowerCase()}` },
              { key: 'path', header: 'Request', render: (r) => <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{r.method} {r.path}</Typography> },
              { key: 'ip', header: 'IP' },
            ]}
          />
        )}
      </QueryState>
    </>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('users');
  return (
    <>
      <PageHeader title="Users and audit" />
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="users" label="Accounts" />
        <Tab value="audit" label="Audit log" />
      </Tabs>
      {tab === 'users' ? <Users /> : <AuditLogs />}
    </>
  );
}
