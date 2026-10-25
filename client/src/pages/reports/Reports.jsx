import { Button, Grid, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader, QueryState, Section, Stat } from '../../components/common.jsx';
import { useToast } from '../../components/Toast.jsx';
import { tokens } from '../../theme.js';
import { label, peso } from '../../utils/format.js';

const PRESETS = [['7 days', 6], ['30 days', 29], ['90 days', 89]];
const axis = { fontSize: 12, fill: '#55636F' };
const short = (d) => dayjs(d).format('MMM D');

export default function Reports() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [range, setRange] = useState({ from: dayjs().subtract(29, 'day').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') });
  const q = useQuery({ queryKey: ['reports', range], queryFn: () => api.reports.summary(range), placeholderData: (p) => p });
  const refresh = useMutation({
    mutationFn: api.reports.refresh,
    onSuccess: () => { toast('Figures recalculated'); qc.invalidateQueries({ queryKey: ['reports'] }); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const isAdmin = user.role === 'admin';

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={isAdmin ? 'Clinic performance and finances. Figures refresh every 15 minutes.' : 'Your consultations and patient outcomes.'}
        actions={isAdmin && <Button variant="outlined" disabled={refresh.isPending} onClick={() => refresh.mutate()}>Refresh now</Button>}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <TextField type="date" label="From" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 180 }} />
        <TextField type="date" label="To" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 180 }} />
        {PRESETS.map(([l, days]) => (
          <Button key={l} size="small" onClick={() => setRange({ from: dayjs().subtract(days, 'day').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') })}>Last {l}</Button>
        ))}
      </Stack>

      <QueryState query={q}>
        {(r) => (
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 3 }}><Stat value={r.totals.total} caption="Appointments" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Stat value={r.totals.completed} caption="Completed visits" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Stat value={`${(r.totals.noShowRate * 100).toFixed(1)}%`} caption="No-show rate" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Stat value={r.totals.telemedicine} caption="Video visits" /></Grid>
            {isAdmin && (
              <>
                <Grid size={{ xs: 6, md: 4 }}><Stat value={peso(r.totals.revenue)} caption="Collections" /></Grid>
                <Grid size={{ xs: 6, md: 4 }}><Stat value={peso(r.totals.outstanding?.amount)} caption={`Receivables (${r.totals.outstanding?.invoices ?? 0} invoices)`} /></Grid>
                <Grid size={{ xs: 12, md: 4 }}><Stat value={r.totals.lowStockItems} caption="Items at reorder level" /></Grid>
              </>
            )}

            <Grid size={{ xs: 12, lg: isAdmin ? 7 : 12 }}>
              <Section title="Appointments per day">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={r.appointmentsByDay}>
                    <CartesianGrid stroke={tokens.line} vertical={false} />
                    <XAxis dataKey="day" tickFormatter={short} tick={axis} />
                    <YAxis allowDecimals={false} tick={axis} />
                    <Tooltip labelFormatter={short} />
                    <Legend />
                    <Bar dataKey="completed" name="Completed" stackId="a" fill={tokens.rx} />
                    <Bar dataKey="cancelled" name="Cancelled" stackId="a" fill="#9DB4C0" />
                    <Bar dataKey="no_shows" name="No-show" stackId="a" fill={tokens.alert} />
                  </BarChart>
                </ResponsiveContainer>
              </Section>
            </Grid>
            {isAdmin && (
              <Grid size={{ xs: 12, lg: 5 }}>
                <Section title="Collections per day">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={r.revenueByDay}>
                      <CartesianGrid stroke={tokens.line} vertical={false} />
                      <XAxis dataKey="day" tickFormatter={short} tick={axis} />
                      <YAxis tick={axis} tickFormatter={(v) => `₱${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                      <Tooltip labelFormatter={short} formatter={(v) => peso(v)} />
                      <Line type="monotone" dataKey="amount" name="Collected" stroke={tokens.ink} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Section>
              </Grid>
            )}
            <Grid size={{ xs: 12, md: 6 }}>
              <Section title="Most frequent diagnoses (ICD-10)">
                {r.topDiagnoses.length ? r.topDiagnoses.map((d) => (
                  <Stack key={d.code} direction="row" sx={{ py: 0.5, borderBottom: 1, borderColor: 'divider', justifyContent: 'space-between' }}>
                    <Typography sx={{ fontWeight: 600 }}>{d.code}</Typography><Typography>{d.count}</Typography>
                  </Stack>
                )) : <Typography color="text.secondary">No coded diagnoses in this period.</Typography>}
              </Section>
            </Grid>
            {isAdmin && (
              <Grid size={{ xs: 12, md: 6 }}>
                <Section title="Collections by payment method">
                  {r.revenueByMethod.length ? r.revenueByMethod.map((m) => (
                    <Stack key={m.method} direction="row" sx={{ py: 0.5, borderBottom: 1, borderColor: 'divider', justifyContent: 'space-between' }}>
                      <Typography>{label(m.method)} <Typography component="span" variant="body2" color="text.secondary">({m.payments} payments)</Typography></Typography>
                      <Typography sx={{ fontWeight: 600 }}>{peso(m.amount)}</Typography>
                    </Stack>
                  )) : <Typography color="text.secondary">No payments in this period.</Typography>}
                </Section>
              </Grid>
            )}
          </Grid>
        )}
      </QueryState>
    </>
  );
}
