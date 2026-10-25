import AddOutlined from '@mui/icons-material/AddOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { Alert, Box, Button, Grid, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/http.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PageHeader, Section } from '../components/common.jsx';
import { useToast } from '../components/Toast.jsx';
import { label } from '../utils/format.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * TOTP enrolment. The QR code is rendered locally from the otpauth:// URL —
 * sending the secret to an online QR service would leak the second factor.
 */
function TwoFactor() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const start = useMutation({ mutationFn: api.auth.mfaSetup, onSuccess: setSetup });
  const enable = useMutation({
    mutationFn: () => api.auth.mfaEnable(code),
    onSuccess: () => { toast('Two-factor authentication is on'); setUser({ ...user, mfaEnabled: true }); setSetup(null); },
  });
  useEffect(() => {
    if (setup?.otpauthUrl) QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 200 }).then(setQr);
  }, [setup]);

  if (user.mfaEnabled) return <Alert severity="success">Two-factor authentication is on. You'll be asked for a code from your authenticator app at each sign-in.</Alert>;
  if (!setup) {
    return (
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Typography color="text.secondary">
          Add a second step to sign-in using an authenticator app such as Google Authenticator or Microsoft Authenticator.
          {user.role !== 'patient' && ' Required for clinic staff because your account can open patient records.'}
        </Typography>
        {start.isError && <Alert severity="error">{errorMessage(start.error)}</Alert>}
        <Button variant="contained" onClick={() => start.mutate()} disabled={start.isPending}>Set up two-factor authentication</Button>
      </Stack>
    );
  }
  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, sm: 'auto' }}>
        {qr && <Box component="img" src={qr} alt="QR code to add RX Clinic to your authenticator app" sx={{ width: 200, height: 200, border: 1, borderColor: 'divider', borderRadius: 1 }} />}
      </Grid>
      <Grid size={{ xs: 12, sm: 'grow' }}>
        <Stack spacing={2}>
          <Typography>1. Scan the QR code with your authenticator app, or enter this key manually:</Typography>
          <Typography sx={{ fontFamily: 'monospace', bgcolor: 'background.default', p: 1, borderRadius: 1, wordBreak: 'break-all' }}>{setup.secret}</Typography>
          <Typography>2. Type the 6-digit code the app shows:</Typography>
          <Stack direction="row" spacing={1}>
            <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} sx={{ width: 160 }}
              slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'one-time-code' } }} />
            <Button variant="contained" disabled={code.length !== 6 || enable.isPending} onClick={() => enable.mutate()}>Turn on</Button>
          </Stack>
          {enable.isError && <Alert severity="error">{errorMessage(enable.error)}</Alert>}
        </Stack>
      </Grid>
    </Grid>
  );
}

/** Weekly clinic hours → drives the slot generator. Saved as a whole (replace), so edits are atomic. */
function ClinicHours() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-schedule'], queryFn: api.doctors.schedule });
  const [blocks, setBlocks] = useState(null);
  useEffect(() => {
    if (q.data && !blocks) {
      setBlocks(q.data.map((b) => ({ key: crypto.randomUUID(), weekday: b.weekday, startTime: b.start_time.slice(0, 5), endTime: b.end_time.slice(0, 5), slotMinutes: b.slot_minutes })));
    }
  }, [q.data, blocks]);
  const save = useMutation({
    mutationFn: () => api.doctors.saveSchedule(blocks.map(({ key, ...b }) => ({ ...b, slotMinutes: Number(b.slotMinutes) }))),
    onSuccess: () => { toast('Clinic hours saved'); qc.invalidateQueries({ queryKey: ['my-schedule'] }); qc.invalidateQueries({ queryKey: ['slots'] }); },
  });
  const upd = (key, patch) => setBlocks((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  if (!blocks) return <Typography color="text.secondary">Loading…</Typography>;

  return (
    <Stack spacing={1.5}>
      {blocks.length === 0 && <Typography color="text.secondary">No clinic hours yet. Patients can't book you until you add some.</Typography>}
      {blocks.map((b) => (
        <Stack key={b.key} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <TextField select label="Day" value={b.weekday} onChange={(e) => upd(b.key, { weekday: Number(e.target.value) })} sx={{ width: 150 }}>
            {DAYS.map((d, i) => <MenuItem key={d} value={i}>{d}</MenuItem>)}
          </TextField>
          <TextField type="time" label="From" value={b.startTime} onChange={(e) => upd(b.key, { startTime: e.target.value })} sx={{ width: 130 }} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField type="time" label="To" value={b.endTime} onChange={(e) => upd(b.key, { endTime: e.target.value })} sx={{ width: 130 }} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField select label="Slot length" value={b.slotMinutes} onChange={(e) => upd(b.key, { slotMinutes: e.target.value })} sx={{ width: 130 }}>
            {[15, 20, 30, 45, 60].map((m) => <MenuItem key={m} value={m}>{m} min</MenuItem>)}
          </TextField>
          <IconButton aria-label="Remove block" onClick={() => setBlocks((xs) => xs.filter((x) => x.key !== b.key))}><DeleteOutline /></IconButton>
        </Stack>
      ))}
      <Stack direction="row" spacing={1}>
        <Button startIcon={<AddOutlined />} onClick={() => setBlocks((xs) => [...xs, { key: crypto.randomUUID(), weekday: 1, startTime: '09:00', endTime: '12:00', slotMinutes: 30 }])}>Add hours</Button>
        <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate()}>Save clinic hours</Button>
      </Stack>
      {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
    </Stack>
  );
}

function TimeOff() {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ start: '', end: '', reason: '' });
  const add = useMutation({
    // datetime-local has no zone; append the browser's offset so the server stores the right instant
    mutationFn: () => {
      const iso = (v) => new Date(v).toISOString();
      return api.doctors.addTimeOff({ start: iso(f.start), end: iso(f.end), reason: f.reason || undefined });
    },
    onSuccess: () => { toast('Time off blocked. Those slots are no longer bookable.'); setF({ start: '', end: '', reason: '' }); qc.invalidateQueries({ queryKey: ['slots'] }); },
  });
  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField type="datetime-local" label="From" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField type="datetime-local" label="Until" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField label="Reason (optional)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <Button variant="outlined" disabled={!f.start || !f.end || f.end <= f.start || add.isPending} onClick={() => add.mutate()} sx={{ whiteSpace: 'nowrap' }}>Block time</Button>
      </Stack>
      {add.isError && <Alert severity="error">{errorMessage(add.error)}</Alert>}
    </Stack>
  );
}

export default function Settings() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Account settings" />
      <Stack spacing={2}>
        <Section title="Account">
          <Typography>{user.firstName} {user.lastName}</Typography>
          <Typography color="text.secondary">{user.email}, {label(user.role)}</Typography>
          {user.role === 'patient' && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Update your contact details and insurance under My health record.</Typography>}
        </Section>
        <Section title="Two-factor authentication"><TwoFactor /></Section>
        {user.role === 'doctor' && (
          <>
            <Section title="Clinic hours"><ClinicHours /></Section>
            <Section title="Time off"><TimeOff /></Section>
          </>
        )}
      </Stack>
    </>
  );
}
