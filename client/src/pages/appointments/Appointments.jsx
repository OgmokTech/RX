import VideocamOutlined from '@mui/icons-material/VideocamOutlined';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, Pagination, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable, PageHeader, QueryState, StatusChip } from '../../components/common.jsx';
import SlotPicker from '../../components/SlotPicker.jsx';
import { useToast } from '../../components/Toast.jsx';
import { dateTime, label } from '../../utils/format.js';

// Mirrors the server's state machine so we only offer valid actions (the API still enforces it)
const TRANSITIONS = {
  patient: { scheduled: ['cancelled'], confirmed: ['cancelled'] },
  doctor: { scheduled: ['confirmed', 'checked_in', 'cancelled', 'no_show'], confirmed: ['checked_in', 'cancelled', 'no_show'], checked_in: ['completed', 'no_show'] },
  receptionist: { scheduled: ['confirmed', 'checked_in', 'cancelled', 'no_show'], confirmed: ['checked_in', 'cancelled', 'no_show'] },
};
TRANSITIONS.admin = TRANSITIONS.doctor;
const ACTION_LABEL = { confirmed: 'Confirm', checked_in: 'Check in', completed: 'Mark completed', cancelled: 'Cancel', no_show: 'Mark no-show' };
const ACTIVE = ['scheduled', 'confirmed', 'checked_in'];

const VIEWS = {
  upcoming: () => ({ from: dayjs().startOf('day').toISOString() }),
  past: () => ({ to: dayjs().startOf('day').toISOString() }),
  all: () => ({}),
};

export default function Appointments() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState('upcoming');
  const [page, setPage] = useState(1);
  const [menu, setMenu] = useState(null);            // { anchor, appt }
  const [cancelling, setCancelling] = useState(null); // appt
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduling, setRescheduling] = useState(null);
  const [newDate, setNewDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [newSlot, setNewSlot] = useState(null);

  const q = useQuery({
    queryKey: ['appointments', view, page],
    queryFn: () => api.appointments.list({ ...VIEWS[view](), page, pageSize: 20 }),
    placeholderData: (prev) => prev,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['slots'] });
    qc.invalidateQueries({ queryKey: ['doctor-dashboard'] });
  };
  const status = useMutation({
    mutationFn: ({ id, ...b }) => api.appointments.setStatus(id, b),
    onSuccess: (_d, v) => { toast(`Appointment ${label(v.status).toLowerCase()}`); refresh(); setCancelling(null); setCancelReason(''); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const reschedule = useMutation({
    mutationFn: () => api.appointments.reschedule(rescheduling.id, newSlot),
    onSuccess: () => { toast('Appointment moved'); refresh(); setRescheduling(null); setNewSlot(null); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const choose = (appt, next) => {
    setMenu(null);
    if (next === 'cancelled') setCancelling(appt);
    else status.mutate({ id: appt.id, status: next });
  };

  const staff = user.role !== 'patient';
  const columns = [
    { key: 'when', header: 'When', render: (a) => dateTime(a.starts_at) },
    staff && { key: 'patient_name', header: 'Patient', render: (a) => <>{a.patient_name}<Typography variant="body2" color="text.secondary">{a.mrn}</Typography></> },
    user.role !== 'doctor' && { key: 'doctor_name', header: 'Doctor', render: (a) => <>{a.doctor_name}<Typography variant="body2" color="text.secondary">{a.specialization}</Typography></> },
    { key: 'type', header: 'Visit', render: (a) => label(a.type) },
    { key: 'reason', header: 'Reason', render: (a) => a.reason || '—' },
    { key: 'status', header: 'Status', render: (a) => <StatusChip status={a.status} /> },
    {
      key: 'actions', header: '', align: 'right',
      render: (a) => {
        const next = TRANSITIONS[user.role]?.[a.status] ?? [];
        const canJoin = a.type === 'telemedicine' && ACTIVE.includes(a.status) && ['patient', 'doctor'].includes(user.role);
        return (
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            {canJoin && <Button size="small" variant="contained" startIcon={<VideocamOutlined />} component={RouterLink} to={`/visit/${a.id}`} target="_blank">Join</Button>}
            {ACTIVE.slice(0, 2).includes(a.status) && user.role !== 'doctor' && (
              <Button size="small" onClick={() => { setRescheduling(a); setNewDate(dayjs(a.starts_at).format('YYYY-MM-DD')); }}>Reschedule</Button>
            )}
            {next.length > 0 && <Button size="small" variant="outlined" onClick={(e) => setMenu({ anchor: e.currentTarget, appt: a })}>Update</Button>}
          </Stack>
        );
      },
    },
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle={user.role === 'doctor' ? 'Your clinic and video visits' : undefined}
        actions={user.role !== 'doctor' && <Button variant="contained" component={RouterLink} to="/appointments/book">Book appointment</Button>}
      />
      <Tabs value={view} onChange={(_e, v) => { setView(v); setPage(1); }} sx={{ mb: 2 }}>
        <Tab value="upcoming" label="Upcoming" />
        <Tab value="past" label="Past" />
        <Tab value="all" label="All" />
      </Tabs>
      <QueryState query={q} empty={{ title: 'No appointments here', body: view === 'upcoming' ? 'Booked visits will show up in this list.' : undefined }}>
        {(d) => (
          <>
            <DataTable columns={columns} rows={d.data} />
            {d.meta.total > 20 && <Pagination sx={{ mt: 2 }} count={Math.ceil(d.meta.total / 20)} page={page} onChange={(_e, p) => setPage(p)} />}
          </>
        )}
      </QueryState>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {(TRANSITIONS[user.role]?.[menu?.appt.status] ?? []).map((s) => (
          <MenuItem key={s} onClick={() => choose(menu.appt, s)} sx={s === 'cancelled' || s === 'no_show' ? { color: 'error.main' } : undefined}>{ACTION_LABEL[s]}</MenuItem>
        ))}
      </Menu>

      <Dialog open={!!cancelling} onClose={() => setCancelling(null)} fullWidth maxWidth="xs">
        <DialogTitle>Cancel this appointment?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>{cancelling && `${dateTime(cancelling.starts_at)} with ${user.role === 'patient' ? cancelling.doctor_name : cancelling.patient_name}.`} The time slot will be released.</Typography>
          <TextField label="Reason (optional)" fullWidth multiline minRows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelling(null)}>Keep appointment</Button>
          <Button color="error" variant="contained" disabled={status.isPending} onClick={() => status.mutate({ id: cancelling.id, status: 'cancelled', cancelReason: cancelReason || undefined })}>Cancel appointment</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!rescheduling} onClose={() => setRescheduling(null)} fullWidth maxWidth="sm">
        <DialogTitle>Pick a new time</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 2 }}>{rescheduling?.doctor_name}, currently {rescheduling && dateTime(rescheduling.starts_at)}</Typography>
          {rescheduling && <SlotPicker doctorId={rescheduling.doctor_id} date={newDate} onDateChange={setNewDate} value={newSlot} onChange={setNewSlot} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRescheduling(null)}>Close</Button>
          <Button variant="contained" disabled={!newSlot || reschedule.isPending} onClick={() => reschedule.mutate()}>Move appointment</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
