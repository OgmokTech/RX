import { Pagination, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable, PageHeader, QueryState, StatusChip } from '../../components/common.jsx';
import { date } from '../../utils/format.js';

export default function Prescriptions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['prescriptions', page], queryFn: () => api.rx.list({ page, pageSize: 20 }), placeholderData: (p) => p });
  const isDoctor = user.role === 'doctor';

  return (
    <>
      <PageHeader
        title="Prescriptions"
        subtitle={isDoctor ? 'Prescriptions you have signed. Write new ones from a patient chart.' : 'Open one to view, print or save it as PDF.'}
      />
      <QueryState query={q} empty={{ title: 'No prescriptions yet', body: isDoctor ? 'Open a patient chart and choose Write prescription.' : 'Prescriptions from your doctors will appear here.' }}>
        {(d) => (
          <>
            <DataTable
              rows={d.data}
              onRowClick={(r) => navigate(`/prescriptions/${r.id}`)}
              columns={[
                { key: 'rx_no', header: 'Rx number', render: (r) => <Typography sx={{ fontWeight: 600 }}>{r.rx_no}</Typography> },
                isDoctor ? { key: 'patient_name', header: 'Patient' } : { key: 'doctor_name', header: 'Prescriber' },
                { key: 'item_count', header: 'Medicines', align: 'right' },
                { key: 'issued_at', header: 'Issued', render: (r) => date(r.issued_at) },
                { key: 'valid_until', header: 'Valid until', render: (r) => date(r.valid_until) },
                { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
              ]}
            />
            {d.meta.total > 20 && <Pagination sx={{ mt: 2 }} count={Math.ceil(d.meta.total / 20)} page={page} onChange={(_e, p) => setPage(p)} />}
          </>
        )}
      </QueryState>
    </>
  );
}
