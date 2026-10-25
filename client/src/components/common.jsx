// Small shared building blocks used across pages.
import { Alert, Box, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { errorMessage } from '../api/http.js';
import { label } from '../utils/format.js';

export function PageHeader({ title, subtitle, actions }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3, alignItems: { sm: 'flex-end' }, justifyContent: 'space-between' }}>
      <Box>
        <Typography variant="h1">{title}</Typography>
        {subtitle && <Typography color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography>}
      </Box>
      {actions && <Stack direction="row" spacing={1}>{actions}</Stack>}
    </Stack>
  );
}

const STATUS_COLOR = {
  scheduled: 'default', confirmed: 'info', checked_in: 'warning', completed: 'success', cancelled: 'default', no_show: 'error',
  active: 'success', dispensed: 'info', expired: 'default',
  ordered: 'default', collected: 'info', in_progress: 'warning', resulted: 'success',
  issued: 'warning', partially_paid: 'info', paid: 'success', void: 'default', draft: 'default',
  routine: 'default', urgent: 'warning', stat: 'error',
  mild: 'default', moderate: 'warning', severe: 'error', major: 'error', contraindicated: 'error', minor: 'default',
};

export const StatusChip = ({ status, size = 'small' }) => (
  <Chip size={size} label={label(status)} color={STATUS_COLOR[status] ?? 'default'} variant={['cancelled', 'void', 'expired'].includes(status) ? 'outlined' : 'filled'} />
);

/** Renders loading / error / empty states for a React Query result. */
export function QueryState({ query, empty, children }) {
  if (query.isLoading) return <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box>;
  if (query.isError) return <Alert severity="error">{errorMessage(query.error)}</Alert>;
  const data = query.data?.data ?? query.data;
  if (empty && Array.isArray(data) && data.length === 0) return <EmptyState {...empty} />;
  return children(query.data);
}

export function EmptyState({ title, body, action }) {
  return (
    <Paper sx={{ p: 4, textAlign: 'center', borderStyle: 'dashed' }}>
      <Typography variant="h3">{title}</Typography>
      {body && <Typography color="text.secondary" sx={{ mt: 1 }}>{body}</Typography>}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Paper>
  );
}

/** columns: [{ key, header, render?, align? }] */
export function DataTable({ columns, rows, onRowClick, rowKey = 'id' }) {
  return (
    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>{columns.map((c) => <TableCell key={c.key} align={c.align}>{c.header}</TableCell>)}</TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r[rowKey]} hover={!!onRowClick} onClick={onRowClick ? () => onRowClick(r) : undefined} sx={{ cursor: onRowClick ? 'pointer' : 'default' }}>
              {columns.map((c) => <TableCell key={c.key} align={c.align}>{c.render ? c.render(r) : r[c.key]}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function Section({ title, action, children, sx }) {
  return (
    <Paper sx={{ p: 2.5, ...sx }}>
      <Stack direction="row" sx={{ mb: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h2">{title}</Typography>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

export const Stat = ({ value, caption }) => (
  <Paper sx={{ p: 2 }}>
    <Typography sx={{ fontSize: '1.75rem', fontWeight: 700, color: 'secondary.main', lineHeight: 1.2 }}>{value}</Typography>
    <Typography variant="body2" color="text.secondary">{caption}</Typography>
  </Paper>
);
