import { Alert, Button, Checkbox, FormControlLabel, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink, Navigate, useNavigate } from 'react-router-dom';
import { errorMessage, fieldErrors } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import AuthLayout from './AuthLayout.jsx';

const EMPTY = { firstName: '', lastName: '', birthDate: '', sex: 'unspecified', phone: '', email: '', password: '' };

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);

  if (user) return <Navigate to="/" replace />;
  // Binds a field to form state and surfaces the server's zod field errors under it
  const field = (name) => ({
    name, value: form[name], onChange: (e) => setForm({ ...form, [name]: e.target.value }),
    error: !!errors[name], helperText: errors[name]?.[0],
  });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      await register({ ...form, phone: form.phone || undefined });
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create your patient account" subtitle="Book visits, see results and message your doctor.">
      <Stack component="form" spacing={2} onSubmit={submit} noValidate>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="First name" required fullWidth autoComplete="given-name" {...field('firstName')} />
          <TextField label="Last name" required fullWidth autoComplete="family-name" {...field('lastName')} />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Birth date" type="date" required fullWidth slotProps={{ inputLabel: { shrink: true } }} {...field('birthDate')} />
          <TextField label="Sex" select fullWidth {...field('sex')}>
            {['female', 'male', 'intersex', 'unspecified'].map((s) => (
              <MenuItem key={s} value={s}>{s === 'unspecified' ? 'Prefer not to say' : s[0].toUpperCase() + s.slice(1)}</MenuItem>
            ))}
          </TextField>
        </Stack>
        <TextField label="Mobile number" placeholder="09171234567" autoComplete="tel" {...field('phone')} />
        <TextField label="Email" type="email" required autoComplete="email" {...field('email')} />
        <TextField
          label="Password" type="password" required autoComplete="new-password" {...field('password')}
          helperText={errors.password?.[0] ?? 'At least 10 characters with upper and lower case letters and a number'}
        />
        <FormControlLabel
          control={<Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} />}
          label={<Typography variant="body2" color="text.secondary">I consent to RX Clinic processing my personal and health information for my care, as described in the privacy notice (RA 10173).</Typography>}
          sx={{ alignItems: 'flex-start', '& .MuiCheckbox-root': { pt: 0.25 } }}
        />
        <Button type="submit" variant="contained" size="large" disabled={busy || !consent}>{busy ? 'Creating account…' : 'Create account'}</Button>
        <Typography variant="body2" color="text.secondary">
          Already registered? <Link component={RouterLink} to="/login">Sign in</Link>
        </Typography>
      </Stack>
    </AuthLayout>
  );
}
