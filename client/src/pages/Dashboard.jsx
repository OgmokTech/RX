import { Alert, Box, Button, Grid, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PageHeader, QueryState, Section, Stat, StatusChip } from '../components/common.jsx';
import { dateTime, label, peso, time } from '../utils/format.js';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function AppointmentList({ rows, showPatient, empty }) {
  const navigate = useNavigate();
  if (!rows.length) return <Typography color="text.secondary">{empty}</Typography>;
  return (
    <List disablePadding>
      {rows.map((a) => (
        <ListItemButton key={a.id} divider onClick={() => navigate(showPatient && a.patient_id ? `/patients/${a.patient_id}?appointment=${a.id}` : '/appointments')}>
          <ListItemText
            primary={showPatient ? a.patient_name : a.doctor_name}
            secondary={`${showPatient ? time(a.starts_at) : dateTime(a.starts_at)}${a.type === 'telemedicine' ? ', video visit' : ''}${a.reason ? ` — ${a.reason}` : ''}`}
          />
          <StatusChip status={a.status} />
        </ListItemButton>
      ))}
    </List>
  );
}

function PatientHome() {
  const upcoming = useQuery({ queryKey: ['appointments', 'upcoming'], queryFn: () => api.appointments.list({ from: dayjs().toISOString(), pageSize: 5 }) });
  const bills = useQuery({ queryKey: ['invoices', 'open'], queryFn: () => api.billing.list({ status: 'open' }) });
  const labs = useQuery({ queryKey: ['labs', 'recent'], queryFn: () => api.labs.list({ status: 'resulted', pageSize: 3 }) });
  const active = (upcoming.data?.data ?? []).filter((a) => ['scheduled', 'confirmed', 'checked_in'].includes(a.status));
  const balance = (bills.data?.data ?? []).reduce((s, i) => s + Number(i.balance), 0);

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Section title="Upcoming visits" action={<Button component={RouterLink} to="/appointments/book" variant="contained">Book a visit</Button>}>
          <QueryState query={upcoming}>{() => <AppointmentList rows={active} empty="You have no upcoming visits." />}</QueryState>
        </Section>
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}>
        <Stack spacing={2}>
          <Section title="Balance due" action={<Button component={RouterLink} to="/billing">View bills</Button>}>
            <Typography sx={{ fontSize: '1.75rem', fontWeight: 700, color: balance ? 'warning.main' : 'success.main' }}>{peso(balance)}</Typography>
          </Section>
          <Section title="Latest lab results" action={<Button component={RouterLink} to="/labs">All results</Button>}>
            <QueryState query={labs}>
              {(d) => d.data.length ? d.data.map((o) => (
                <Typography key={o.id} variant="body2" sx={{ py: 0.5 }}>
                  {o.items.map((i) => i.test).join(', ')} <Typography component="span" variant="body2" color="text.secondary">— {dateTime(o.completed_at)}</Typography>
                </Typography>
              )) : <Typography color="text.secondary">No results yet.</Typography>}
            </QueryState>
          </Section>
        </Stack>
      </Grid>
    </Grid>
  );
}

function DoctorHome() {
  const q = useQuery({ queryKey: ['doctor-dashboard'], queryFn: api.doctors.dashboard, refetchInterval: 60_000 });
  const navigate = useNavigate();
  return (
    <QueryState query={q}>
      {({ today, pendingLabs, stats }) => (
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, md: 3 }}><Stat value={today.length} caption="Visits today" /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><Stat value={today.filter((a) => a.status === 'checked_in').length} caption="Waiting now" /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><Stat value={stats.upcoming} caption="Upcoming bookings" /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><Stat value={stats.patients} caption="Patients under your care" /></Grid>
          <Grid size={{ xs: 12, md: 7 }}>
            <Section title="Today's schedule"><AppointmentList rows={today} showPatient empty="No visits scheduled today." /></Section>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <Section title="Labs awaiting results">
              {pendingLabs.length ? (
                <List disablePadding>
                  {pendingLabs.map((o) => (
                    <ListItemButton key={o.id} divider onClick={() => navigate('/labs')}>
                      <ListItemText primary={o.patient_name} secondary={`Ordered ${dateTime(o.ordered_at)}`} />
                      <StatusChip status={o.priority} />
                    </ListItemButton>
                  ))}
                </List>
              ) : <Typography color="text.secondary">Nothing pending.</Typography>}
            </Section>
          </Grid>
        </Grid>
      )}
    </QueryState>
  );
}

function StaffHome({ role }) {
  const start = dayjs().startOf('day');
  const today = useQuery({
    queryKey: ['appointments', 'today'],
    queryFn: () => api.appointments.list({ from: start.toISOString(), to: start.add(1, 'day').toISOString(), pageSize: 100 }),
    refetchInterval: 60_000,
  });
  const bills = useQuery({ queryKey: ['invoices', 'open'], queryFn: () => api.billing.list({ status: 'open', pageSize: 100 }) });
  const low = useQuery({ queryKey: ['inventory', 'low'], queryFn: () => api.inventory.list({ lowStock: 'true' }) });
  const rows = today.data?.data ?? [];
  const byStatus = (s) => rows.filter((a) => a.status === s).length;

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 6, md: 3 }}><Stat value={rows.length} caption="Appointments today" /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><Stat value={byStatus('checked_in')} caption="Checked in" /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><Stat value={bills.data?.meta.total ?? '—'} caption="Unpaid invoices" /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><Stat value={low.data?.meta.total ?? '—'} caption="Items at reorder level" /></Grid>
      {low.data?.meta.total > 0 && (
        <Grid size={12}>
          <Alert severity="warning" action={<Button color="inherit" component={RouterLink} to="/inventory">Review</Button>}>
            {low.data.data.slice(0, 3).map((i) => i.name).join(', ')}{low.data.meta.total > 3 ? ' and others' : ''} need restocking.
          </Alert>
        </Grid>
      )}
      <Grid size={12}>
        <Section title="Today at the clinic" action={<Button component={RouterLink} to="/appointments" variant="outlined">Manage schedule</Button>}>
          <QueryState query={today}>
            {() => rows.length ? (
              <List disablePadding>
                {rows.map((a) => (
                  <Box key={a.id} sx={{ display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 2, py: 1, borderBottom: 1, borderColor: 'divider', alignItems: 'center' }}>
                    <Typography sx={{ fontWeight: 600 }}>{time(a.starts_at)}</Typography>
                    <Box>
                      <Typography>{a.patient_name}</Typography>
                      <Typography variant="body2" color="text.secondary">{a.doctor_name}, {label(a.type)}</Typography>
                    </Box>
                    <StatusChip status={a.status} />
                  </Box>
                ))}
              </List>
            ) : <Typography color="text.secondary">No appointments today.</Typography>}
          </QueryState>
        </Section>
      </Grid>
      {role === 'admin' && (
        <Grid size={12}>
          <Typography variant="body2" color="text.secondary">Clinic-wide figures are in <RouterLink to="/reports">Reports</RouterLink>.</Typography>
        </Grid>
      )}
    </Grid>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const name = user.role === 'doctor' ? `Dr. ${user.lastName}` : user.firstName;
  return (
    <>
      <PageHeader title={`${greeting()}, ${name}`} subtitle={dayjs().format('dddd, MMMM D, YYYY')} />
      {user.role === 'patient' && <PatientHome />}
      {user.role === 'doctor' && <DoctorHome />}
      {['admin', 'receptionist'].includes(user.role) && <StaffHome role={user.role} />}
    </>
  );
}
