import { Alert, Box, Button, Card, CardActionArea, Grid, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader, QueryState, Section } from '../../components/common.jsx';
import PatientPicker from '../../components/PatientPicker.jsx';
import SlotPicker from '../../components/SlotPicker.jsx';
import { useToast } from '../../components/Toast.jsx';
import { dateTime, peso } from '../../utils/format.js';

export default function BookAppointment() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [patient, setPatient] = useState(null);
  const [doctor, setDoctor] = useState(null);
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [slot, setSlot] = useState(null);
  const [type, setType] = useState('in_person');
  const [reason, setReason] = useState('');
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: api.doctors.list, staleTime: 5 * 60_000 });

  const book = useMutation({
    mutationFn: () => api.appointments.book({ doctorId: doctor.id, startsAt: slot, type, reason: reason || undefined, patientId: patient?.id }),
    onSuccess: () => {
      toast('Appointment booked. A confirmation is on its way.');
      qc.invalidateQueries({ queryKey: ['appointments'] });
      navigate('/appointments');
    },
    onError: () => qc.invalidateQueries({ queryKey: ['slots'] }), // slot may have just been taken: refresh the grid
  });

  const isStaff = user.role !== 'patient';
  const ready = doctor && slot && (!isStaff || patient);

  return (
    <>
      <PageHeader title="Book an appointment" subtitle="Choose a doctor, then an open time." />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack spacing={2}>
            {isStaff && <Section title="Patient"><PatientPicker value={patient} onChange={setPatient} /></Section>}
            <Section title="Doctor">
              <QueryState query={doctors} empty={{ title: 'No doctors are accepting bookings' }}>
                {(list) => (
                  <Box sx={{ display: 'grid', gridTemplateColumns: { sm: '1fr 1fr' }, gap: 1.5 }}>
                    {list.filter((d) => d.is_accepting).map((d) => (
                      <Card key={d.id} variant="outlined" sx={{ borderColor: doctor?.id === d.id ? 'primary.main' : 'divider', borderWidth: doctor?.id === d.id ? 2 : 1 }}>
                        <CardActionArea sx={{ p: 2 }} onClick={() => { setDoctor(d); setSlot(null); }} aria-pressed={doctor?.id === d.id}>
                          <Typography variant="h3">Dr. {d.first_name} {d.last_name}</Typography>
                          <Typography variant="body2" color="text.secondary">{d.specialization}</Typography>
                          <Typography variant="body2" sx={{ mt: 1 }}>Consultation {peso(d.consultation_fee)}</Typography>
                        </CardActionArea>
                      </Card>
                    ))}
                  </Box>
                )}
              </QueryState>
            </Section>
            <Section title="Date and time">
              <SlotPicker doctorId={doctor?.id} date={date} onDateChange={setDate} value={slot} onChange={setSlot} />
            </Section>
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Section title="Visit details" sx={{ position: { md: 'sticky' }, top: 16 }}>
            <Stack spacing={2}>
              <ToggleButtonGroup exclusive fullWidth value={type} onChange={(_e, v) => v && setType(v)} size="small">
                <ToggleButton value="in_person">At the clinic</ToggleButton>
                <ToggleButton value="telemedicine">Video visit</ToggleButton>
              </ToggleButtonGroup>
              <TextField label="Reason for visit" multiline minRows={3} value={reason} onChange={(e) => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
              <Box sx={{ p: 1.5, bgcolor: 'background.default', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary">Summary</Typography>
                <Typography>{doctor ? `Dr. ${doctor.first_name} ${doctor.last_name}` : 'No doctor chosen'}</Typography>
                <Typography>{slot ? dateTime(slot) : 'No time chosen'}</Typography>
              </Box>
              {book.isError && <Alert severity="error">{errorMessage(book.error)}</Alert>}
              <Button variant="contained" size="large" disabled={!ready || book.isPending} onClick={() => book.mutate()}>
                {book.isPending ? 'Booking…' : 'Confirm booking'}
              </Button>
            </Stack>
          </Section>
        </Grid>
      </Grid>
    </>
  );
}
