import PrintOutlined from '@mui/icons-material/PrintOutlined';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { QueryState, StatusChip } from '../../components/common.jsx';
import { useToast } from '../../components/Toast.jsx';
import { tokens } from '../../theme.js';
import { date, label } from '../../utils/format.js';

const serif = { fontFamily: tokens.serif };

/** A line with a label and an underlined value, like the blanks on a printed Rx pad. */
const Blank = ({ k, v, flex = 1 }) => (
  <Stack direction="row" spacing={0.75} sx={{ flex, alignItems: 'baseline', minWidth: 0 }}>
    <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{k}</Typography>
    <Typography sx={{ ...serif, flex: 1, borderBottom: `1px solid ${tokens.line}`, px: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v || '\u00A0'}</Typography>
  </Stack>
);

/**
 * Philippine-style prescription pad: patient blanks, the ℞ superscription, generic name first
 * (Generics Act, RA 6675), and the prescriber's PRC license, PTR and S2 numbers in the signature block.
 * The same component is the screen view and the print layout (see @media print).
 */
export default function PrescriptionPad() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['prescription', id], queryFn: () => api.rx.get(id) });
  const setStatus = useMutation({
    mutationFn: (status) => api.rx.setStatus(id, status),
    onSuccess: () => { toast('Prescription updated'); qc.invalidateQueries({ queryKey: ['prescription', id] }); qc.invalidateQueries({ queryKey: ['prescriptions'] }); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <QueryState query={q}>
      {(rx) => {
        const controlled = rx.items.some((i) => i.is_controlled);
        return (
          <>
            <Stack direction="row" spacing={1} className="no-print" sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
              <Button component={RouterLink} to="/prescriptions">All prescriptions</Button>
              <Box sx={{ flex: 1 }} />
              <StatusChip status={rx.status} size="medium" />
              {user.role === 'doctor' && rx.status === 'active' && (
                <Button color="error" onClick={() => setStatus.mutate('cancelled')} disabled={setStatus.isPending}>Cancel prescription</Button>
              )}
              <Button variant="contained" startIcon={<PrintOutlined />} onClick={() => window.print()}>Print or save PDF</Button>
            </Stack>
            {rx.status === 'cancelled' && <Alert severity="warning" className="no-print" sx={{ mb: 2 }}>This prescription was cancelled and must not be dispensed.</Alert>}

            <Box
              component="article" aria-label={`Prescription ${rx.rx_no}`}
              sx={{
                maxWidth: 640, mx: 'auto', bgcolor: '#fff', border: `1px solid ${tokens.line}`, borderTop: `6px solid ${tokens.rx}`,
                p: { xs: 3, sm: 5 }, position: 'relative',
                '@media print': { border: 0, maxWidth: 'none', p: 0 },
              }}
            >
              {/* Letterhead */}
              <Box sx={{ textAlign: 'center', pb: 2, borderBottom: `2px solid ${tokens.ink}` }}>
                <Typography sx={{ ...serif, fontSize: '1.5rem', fontWeight: 600, color: tokens.ink }}>Dr. {rx.doctor_name}, MD</Typography>
                <Typography sx={{ ...serif, fontStyle: 'italic' }}>{rx.specialization}</Typography>
                <Typography variant="body2" color="text.secondary">RX Clinic, Ormoc City, Leyte</Typography>
              </Box>

              {/* Patient blanks */}
              <Stack spacing={1.25} sx={{ mt: 2.5 }}>
                <Stack direction="row" spacing={2}><Blank k="Patient" v={rx.patient_name} flex={3} /><Blank k="Date" v={date(rx.issued_at)} flex={1.4} /></Stack>
                <Stack direction="row" spacing={2}><Blank k="Address" v={rx.patient_city} flex={3} /><Blank k="Age" v={rx.patient_age} /><Blank k="Sex" v={label(rx.sex)?.[0]} /></Stack>
              </Stack>

              {/* Superscription + inscriptions */}
              <Stack direction="row" spacing={2} sx={{ mt: 3, minHeight: 280 }}>
                <Typography aria-hidden sx={{ ...serif, fontSize: '4rem', lineHeight: 0.9, color: tokens.rx }}>℞</Typography>
                <Box component="ol" sx={{ flex: 1, m: 0, pl: 2.5, pt: 1 }}>
                  {rx.items.map((i) => (
                    <Box component="li" key={i.id} sx={{ mb: 2.25, ...serif }}>
                      <Typography sx={{ ...serif, fontSize: '1.15rem', fontWeight: 600 }}>
                        {i.generic_name} {i.strength} {i.form}
                        {i.brand_name && <Typography component="span" sx={{ ...serif, fontWeight: 400 }}> ({i.brand_name})</Typography>}
                        <Typography component="span" sx={{ ...serif, float: 'right' }}>#{i.quantity}</Typography>
                      </Typography>
                      <Typography sx={{ ...serif, fontStyle: 'italic' }}>
                        Sig: {i.dose} {i.route !== 'oral' ? `${i.route} ` : 'by mouth '}{i.frequency}{i.duration_days ? ` for ${i.duration_days} days` : ''}
                      </Typography>
                      {i.instructions && <Typography variant="body2" sx={serif}>{i.instructions}</Typography>}
                    </Box>
                  ))}
                  {rx.notes && <Typography variant="body2" sx={{ ...serif, mt: 2, color: 'text.secondary' }}>Note: {rx.notes}</Typography>}
                </Box>
              </Stack>

              {/* Signature block */}
              <Stack direction="row" sx={{ mt: 3, justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{rx.rx_no}</Typography>
                  <Typography variant="body2" color="text.secondary">Valid until {date(rx.valid_until)}</Typography>
                  {rx.pharmacy_name && <Typography variant="body2" color="text.secondary">Sent to {rx.pharmacy_name}</Typography>}
                </Box>
                <Box sx={{ minWidth: 240, textAlign: 'center' }}>
                  <Box sx={{ borderBottom: `1px solid ${tokens.ink}`, height: 40 }} />
                  <Typography sx={{ ...serif, fontWeight: 600, mt: 0.5 }}>Dr. {rx.doctor_name}, MD</Typography>
                  <Typography variant="body2">PRC Lic. No. {rx.license_no}</Typography>
                  <Typography variant="body2">PTR No. {rx.ptr_no || '________'}</Typography>
                  {controlled && <Typography variant="body2">S2 No. {rx.s2_no || '________'}</Typography>}
                </Box>
              </Stack>
              {rx.status === 'cancelled' && (
                <Typography aria-hidden sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: '5rem', fontWeight: 800, color: 'rgba(180,35,24,0.14)', transform: 'rotate(-20deg)', pointerEvents: 'none' }}>
                  CANCELLED
                </Typography>
              )}
            </Box>
          </>
        );
      }}
    </QueryState>
  );
}
