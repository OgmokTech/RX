import { Box, Paper, Stack, Typography } from '@mui/material';
import { tokens } from '../../theme.js';

/** Split layout shared by sign-in and registration. */
export default function AuthLayout({ title, subtitle, children }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { md: '1fr 1fr' }, bgcolor: 'background.default' }}>
      <Box sx={{ display: { xs: 'none', md: 'flex' }, bgcolor: tokens.ink, color: '#fff', p: 6, flexDirection: 'column', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box aria-hidden sx={{ width: 40, height: 40, borderRadius: 1.5, bgcolor: tokens.rx, display: 'grid', placeItems: 'center', fontFamily: tokens.serif, fontSize: 26 }}>℞</Box>
          <Typography sx={{ fontWeight: 700, fontSize: '1.2rem' }}>RX Clinic</Typography>
        </Stack>
        <Box>
          <Typography sx={{ fontFamily: tokens.serif, fontSize: '2.1rem', lineHeight: 1.25, maxWidth: 440 }}>
            Appointments, records and prescriptions in one secure place.
          </Typography>
          <Typography sx={{ mt: 2, color: 'rgba(255,255,255,0.7)', maxWidth: 420 }}>
            Your health information is encrypted and handled under the Data Privacy Act of 2012 (RA 10173).
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)' }}>© {new Date().getFullYear()} RX Clinic</Typography>
      </Box>
      <Box sx={{ display: 'grid', placeItems: 'center', p: 3 }}>
        <Paper sx={{ p: { xs: 3, sm: 4 }, width: '100%', maxWidth: 440 }}>
          <Typography variant="h1">{title}</Typography>
          {subtitle && <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>{subtitle}</Typography>}
          {children}
        </Paper>
      </Box>
    </Box>
  );
}
