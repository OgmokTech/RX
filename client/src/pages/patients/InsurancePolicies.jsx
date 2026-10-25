import { Alert, Button, Checkbox, FormControlLabel, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/http.js';
import { date } from '../../utils/format.js';

const EMPTY = { provider: '', memberNo: '', validUntil: '', isPrimary: false };

/** PhilHealth / HMO cards. Member numbers are encrypted server-side; only the last 4 digits come back. */
export default function InsurancePolicies({ patientId }) {
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const policies = useQuery({ queryKey: ['policies', patientId], queryFn: () => api.patients.policies(patientId) });
  const add = useMutation({
    mutationFn: () => api.patients.addPolicy(patientId, { ...f, validUntil: f.validUntil || undefined }),
    onSuccess: () => { setF(EMPTY); qc.invalidateQueries({ queryKey: ['policies', patientId] }); },
  });

  return (
    <>
      {policies.data?.length ? (
        <List dense disablePadding>
          {policies.data.map((p) => (
            <ListItem key={p.id} disableGutters divider>
              <ListItemText primary={`${p.provider}${p.is_primary ? ' (primary)' : ''}`} secondary={`Member no. ending ${p.member_no_last4}${p.valid_until ? `, valid until ${date(p.valid_until)}` : ''}`} />
            </ListItem>
          ))}
        </List>
      ) : <Typography color="text.secondary">No insurance on file.</Typography>}
      <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
        <TextField size="small" label="Provider" placeholder="PhilHealth" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} sx={{ flex: 1, minWidth: 130 }} />
        <TextField size="small" label="Member number" value={f.memberNo} onChange={(e) => setF({ ...f, memberNo: e.target.value })} sx={{ flex: 1, minWidth: 150 }} autoComplete="off" />
        <TextField size="small" type="date" label="Valid until" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
        <FormControlLabel control={<Checkbox size="small" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} />} label="Primary" />
        <Button variant="outlined" disabled={f.provider.length < 2 || f.memberNo.length < 4 || add.isPending} onClick={() => add.mutate()}>Add</Button>
      </Stack>
      {add.isError && <Alert severity="error" sx={{ mt: 1 }}>{errorMessage(add.error)}</Alert>}
    </>
  );
}
