import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../api/endpoints.js';
import { errorMessage } from '../api/http.js';
import { time } from '../utils/format.js';

/**
 * Date field + grid of the doctor's open slots for that day.
 * Slots come from the server (schedule − booked − time off), so the UI never
 * offers a time the API would reject. Cached 60s server-side, 30s here.
 */
export default function SlotPicker({ doctorId, date, onDateChange, value, onChange }) {
  const slots = useQuery({
    queryKey: ['slots', doctorId, date],
    queryFn: () => api.doctors.slots(doctorId, date),
    enabled: !!doctorId && !!date,
    staleTime: 30_000,
  });
  const future = (slots.data ?? []).filter((s) => dayjs(s.start).isAfter(dayjs()));

  return (
    <Box>
      <TextField
        label="Date" type="date" value={date} onChange={(e) => { onDateChange(e.target.value); onChange(null); }}
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: dayjs().format('YYYY-MM-DD'), max: dayjs().add(90, 'day').format('YYYY-MM-DD') } }}
        sx={{ mb: 2, width: 220 }}
      />
      {!doctorId ? (
        <Typography color="text.secondary">Choose a doctor to see open times.</Typography>
      ) : slots.isLoading ? (
        <CircularProgress size={24} />
      ) : slots.isError ? (
        <Alert severity="error">{errorMessage(slots.error)}</Alert>
      ) : future.length === 0 ? (
        <Typography color="text.secondary">No clinic hours on this day. Try another date.</Typography>
      ) : (
        <Box role="radiogroup" aria-label="Available times" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 1 }}>
          {future.map((s) => (
            <Button
              key={s.start} role="radio" aria-checked={value === s.start} disabled={!s.available}
              variant={value === s.start ? 'contained' : 'outlined'} onClick={() => onChange(s.start)}
              sx={{ textDecoration: s.available ? 'none' : 'line-through' }}
            >
              {time(s.start)}
            </Button>
          ))}
        </Box>
      )}
    </Box>
  );
}
