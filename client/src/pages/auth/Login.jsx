import { Alert, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import AuthLayout from './AuthLayout.jsx';

export default function Login() {
  const { user, login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [mfaToken, setMfaToken] = useState(null); // set when the account has 2FA on
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const goHome = () => navigate(location.state?.from?.pathname ?? '/', { replace: true });
  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mfaToken) {
        await verifyMfa(mfaToken, code);
        goHome();
      } else {
        const res = await login(form.email.trim(), form.password);
        if (res.mfaToken) setMfaToken(res.mfaToken);
        else goHome();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={mfaToken ? 'Enter your code' : 'Sign in'}
      subtitle={mfaToken ? 'Open your authenticator app and type the 6-digit code.' : 'Use the email and password for your clinic account.'}
    >
      <Stack component="form" spacing={2} onSubmit={submit} noValidate>
        {error && <Alert severity="error">{error}</Alert>}
        {mfaToken ? (
          <TextField
            label="Authentication code" value={code} autoFocus required
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 6 } }}
          />
        ) : (
          <>
            <TextField label="Email" type="email" autoComplete="email" required autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <TextField label="Password" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </>
        )}
        <Button type="submit" variant="contained" size="large" disabled={busy || (mfaToken ? code.length !== 6 : !form.email || !form.password)}>
          {busy ? 'Checking…' : mfaToken ? 'Verify' : 'Sign in'}
        </Button>
        {mfaToken ? (
          <Button onClick={() => { setMfaToken(null); setCode(''); }}>Use a different account</Button>
        ) : (
          <Typography variant="body2" color="text.secondary">
            New patient? <Link component={RouterLink} to="/register">Create an account</Link>
          </Typography>
        )}
      </Stack>
    </AuthLayout>
  );
}
