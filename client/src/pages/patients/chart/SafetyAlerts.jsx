import { Alert, AlertTitle, Stack } from '@mui/material';

export const BLOCKING = new Set(['major', 'contraindicated']); // same rule as the server engine

/** Renders drug-safety alerts, worst first. */
export default function SafetyAlerts({ alerts }) {
  if (!alerts?.length) return null;
  const rank = { contraindicated: 0, major: 1, moderate: 2, minor: 3 };
  return (
    <Stack spacing={1}>
      {[...alerts].sort((a, b) => rank[a.severity] - rank[b.severity]).map((a, i) => (
        <Alert key={i} severity={BLOCKING.has(a.severity) ? 'error' : 'warning'} variant={BLOCKING.has(a.severity) ? 'filled' : 'standard'}>
          <AlertTitle sx={{ mb: 0 }}>{a.severity === 'contraindicated' ? 'Contraindicated' : `${a.severity[0].toUpperCase()}${a.severity.slice(1)} ${a.type}`}</AlertTitle>
          {a.message}
        </Alert>
      ))}
    </Stack>
  );
}
