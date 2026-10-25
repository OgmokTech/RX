import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/http.js';
import { tokens } from '../../theme.js';
import { time } from '../../utils/format.js';

/**
 * Full-screen video room. The API only hands out the (unguessable) room name to the
 * two participants inside the appointment window, and logs join/leave to MongoDB.
 */
export default function VideoVisit() {
  const { appointmentId } = useParams();
  const join = useMutation({ mutationFn: () => api.telemedicine.join(appointmentId) });

  useEffect(() => {
    join.mutate();
    const leave = () => api.telemedicine.leave(appointmentId).catch(() => {});
    window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('beforeunload', leave); leave(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId]);

  const room = join.data;
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: tokens.ink }}>
      <Stack direction="row" sx={{ px: 2, py: 1.25, color: '#fff', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontWeight: 600 }}>{room ? `Video visit with ${room.counterpart}` : 'Video visit'}</Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {room && <Typography variant="body2" sx={{ opacity: 0.7 }}>Scheduled to end {time(room.endsAt)}</Typography>}
          <Button variant="outlined" color="inherit" size="small" component={RouterLink} to="/appointments">Leave</Button>
        </Stack>
      </Stack>
      <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        {join.isPending && <CircularProgress sx={{ color: '#fff' }} />}
        {join.isError && (
          <Alert severity="warning" action={<Button color="inherit" onClick={() => join.mutate()}>Try again</Button>}>{errorMessage(join.error)}</Alert>
        )}
        {room && (
          <Box
            component="iframe" title="Video consultation"
            src={`https://${room.domain}/${encodeURIComponent(room.roomName)}#userInfo.displayName=${encodeURIComponent(JSON.stringify(room.displayName))}&config.prejoinPageEnabled=false`}
            allow="camera; microphone; fullscreen; display-capture; autoplay"
            sx={{ width: '100%', height: '100%', border: 0 }}
          />
        )}
      </Box>
    </Box>
  );
}
