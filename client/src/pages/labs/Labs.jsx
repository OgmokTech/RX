import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Pagination, Paper, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader, QueryState, StatusChip } from '../../components/common.jsx';
import { useToast } from '../../components/Toast.jsx';
import { dateTime, label } from '../../utils/format.js';

const FLAGS = { L: 'Low', H: 'High', LL: 'Critically low', HH: 'Critically high', A: 'Abnormal' };

function ResultDialog({ target, onClose }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ value: '', unit: target.item.unit ?? '', abnormalFlag: '', notes: '' });
  const save = useMutation({
    mutationFn: () => api.labs.result(target.order.id, target.item.id, {
      value: f.value, unit: f.unit || undefined, abnormalFlag: f.abnormalFlag || null, notes: f.notes || undefined,
    }),
    onSuccess: () => {
      toast(`${target.item.test} result saved`);
      qc.invalidateQueries({ queryKey: ['labs'] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{target.item.test}</DialogTitle>
      <DialogContent dividers>
        <Typography color="text.secondary" sx={{ mb: 2 }}>{target.order.patient_name}{target.item.range ? `, reference ${target.item.range}` : ''}</Typography>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1}>
            <TextField label="Result" autoFocus value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
            <TextField label="Unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} sx={{ width: 120 }} />
          </Stack>
          <TextField select label="Flag" value={f.abnormalFlag} onChange={(e) => setF({ ...f, abnormalFlag: e.target.value })}>
            <MenuItem value="">Within range</MenuItem>
            {Object.entries(FLAGS).map(([k, v]) => <MenuItem key={k} value={k}>{v} ({k})</MenuItem>)}
          </TextField>
          <TextField label="Remarks" multiline minRows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          {['LL', 'HH'].includes(f.abnormalFlag) && <Alert severity="error">Critical value: call the ordering doctor as well as saving this result.</Alert>}
          {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={!f.value || save.isPending} onClick={() => save.mutate()}>Save result</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Labs() {
  const { user } = useAuth();
  const [status, setStatus] = useState(user.role === 'patient' ? 'all' : 'open');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState(null);
  const q = useQuery({ queryKey: ['labs', status, page], queryFn: () => api.labs.list({ status, page, pageSize: 10 }), placeholderData: (p) => p });
  const canResult = ['admin', 'doctor'].includes(user.role);

  return (
    <>
      <PageHeader
        title={user.role === 'patient' ? 'Lab results' : 'Lab orders'}
        subtitle={canResult ? 'Enter results as they come back from the laboratory. The patient and doctor are notified.' : 'Results appear here once the laboratory releases them.'}
      />
      <Tabs value={status} onChange={(_e, v) => { setStatus(v); setPage(1); }} sx={{ mb: 2 }}>
        <Tab value="open" label="Pending" />
        <Tab value="resulted" label="Resulted" />
        <Tab value="all" label="All" />
      </Tabs>
      <QueryState query={q} empty={{ title: status === 'open' ? 'No pending lab orders' : 'No lab orders' }}>
        {(d) => (
          <Stack spacing={2}>
            {d.data.map((o) => (
              <Paper key={o.id} sx={{ overflow: 'hidden' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ p: 2, alignItems: { sm: 'center' }, borderBottom: 1, borderColor: 'divider' }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="h3">{user.role === 'patient' ? `Ordered by ${o.doctor_name}` : `${o.patient_name} (${o.mrn})`}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Ordered {dateTime(o.ordered_at)}{user.role !== 'patient' ? ` by ${o.doctor_name}` : ''}{o.completed_at ? `, completed ${dateTime(o.completed_at)}` : ''}
                    </Typography>
                    {o.clinical_notes && user.role !== 'patient' && <Typography variant="body2" sx={{ mt: 0.5 }}>Clinical notes: {o.clinical_notes}</Typography>}
                  </Box>
                  <Stack direction="row" spacing={1}><StatusChip status={o.priority} /><StatusChip status={o.status} /></Stack>
                </Stack>
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow><TableCell>Test</TableCell><TableCell>Result</TableCell><TableCell>Reference</TableCell><TableCell>Status</TableCell>{canResult && <TableCell />}</TableRow>
                    </TableHead>
                    <TableBody>
                      {o.items.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.test}</TableCell>
                          <TableCell sx={{ fontWeight: i.flag ? 700 : 400, color: i.flag ? 'error.main' : 'inherit' }}>
                            {i.value ? `${i.value} ${i.unit ?? ''}` : '—'} {i.flag && `(${FLAGS[i.flag] ?? i.flag})`}
                            {i.notes && <Typography variant="body2" color="text.secondary">{i.notes}</Typography>}
                          </TableCell>
                          <TableCell>{i.range || '—'}</TableCell>
                          <TableCell>{label(i.status)}</TableCell>
                          {canResult && (
                            <TableCell align="right">
                              {i.status !== 'resulted' && <Button size="small" onClick={() => setTarget({ order: o, item: i })}>Enter result</Button>}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </Paper>
            ))}
            {d.meta.total > 10 && <Pagination count={Math.ceil(d.meta.total / 10)} page={page} onChange={(_e, p) => setPage(p)} />}
          </Stack>
        )}
      </QueryState>
      {target && <ResultDialog key={target.item.id} target={target} onClose={() => setTarget(null)} />}
    </>
  );
}
