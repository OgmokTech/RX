import { Alert, Box, Button, Grid, Stack, Tab, Tabs, TextField } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../api/endpoints.js';
import { errorMessage, fieldErrors } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader, QueryState, Section } from '../../components/common.jsx';
import { useToast } from '../../components/Toast.jsx';
import InsurancePolicies from './InsurancePolicies.jsx';
import { ClinicalLists, EncounterHistory, LabHistory } from './PatientChart.jsx';

/** Contact details, address and emergency contact — the parts of the profile a patient maintains. */
function ProfileForm({ patientId }) {
  const toast = useToast();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ['patient', patientId], queryFn: () => api.patients.get(patientId) });
  const [f, setF] = useState(null);
  useEffect(() => {
    if (profile.data && !f) {
      const p = profile.data;
      setF({
        phone: p.phone ?? '', email: p.email ?? '', bloodType: p.blood_type ?? '',
        street: p.address?.street ?? '', barangay: p.address?.barangay ?? '', city: p.address?.city ?? '', province: p.address?.province ?? '',
        ecName: p.emergency_contact?.name ?? '', ecRelation: p.emergency_contact?.relation ?? '', ecPhone: p.emergency_contact?.phone ?? '',
      });
    }
  }, [profile.data, f]);

  const save = useMutation({
    mutationFn: () => api.patients.update(patientId, {
      phone: f.phone || null, email: f.email || null, bloodType: f.bloodType || null,
      address: { street: f.street, barangay: f.barangay, city: f.city, province: f.province },
      emergencyContact: { name: f.ecName, relation: f.ecRelation, phone: f.ecPhone },
    }),
    onSuccess: () => { toast('Profile updated'); qc.invalidateQueries({ queryKey: ['patient', patientId] }); },
  });
  const errs = fieldErrors(save.error);
  if (!f) return <QueryState query={profile}>{() => null}</QueryState>;
  const bind = (k, errKey = k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }), error: !!errs[errKey], helperText: errs[errKey]?.[0], fullWidth: true, size: 'small' });

  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 5 }}><TextField label="Mobile number" {...bind('phone')} /></Grid>
        <Grid size={{ xs: 12, sm: 5 }}><TextField label="Email for notices" {...bind('email')} /></Grid>
        <Grid size={{ xs: 12, sm: 2 }}><TextField label="Blood type" placeholder="O+" {...bind('bloodType')} /></Grid>
        <Grid size={{ xs: 12, sm: 6 }}><TextField label="Street" {...bind('street', 'address')} /></Grid>
        <Grid size={{ xs: 12, sm: 6 }}><TextField label="Barangay" {...bind('barangay', 'address')} /></Grid>
        <Grid size={{ xs: 12, sm: 6 }}><TextField label="City or municipality" {...bind('city', 'address')} /></Grid>
        <Grid size={{ xs: 12, sm: 6 }}><TextField label="Province" {...bind('province', 'address')} /></Grid>
        <Grid size={{ xs: 12, sm: 5 }}><TextField label="Emergency contact" {...bind('ecName', 'emergencyContact')} /></Grid>
        <Grid size={{ xs: 12, sm: 3 }}><TextField label="Relationship" {...bind('ecRelation', 'emergencyContact')} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><TextField label="Their mobile" {...bind('ecPhone', 'emergencyContact')} /></Grid>
      </Grid>
      {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
      <Box><Button variant="contained" disabled={save.isPending} onClick={() => save.mutate()}>Save changes</Button></Box>
    </Stack>
  );
}

export default function MyRecords() {
  const { user } = useAuth();
  const [tab, setTab] = useState('health');
  const chart = useQuery({ queryKey: ['chart', user.patientId], queryFn: () => api.patients.chart(user.patientId) });

  return (
    <>
      <PageHeader title="My health record" subtitle="Keep your allergies and medicines up to date so your doctor can prescribe safely." />
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable">
        <Tab value="health" label="Allergies and medicines" />
        <Tab value="visits" label="Visit notes" />
        <Tab value="labs" label="Lab results" />
        <Tab value="profile" label="Profile and insurance" />
      </Tabs>
      {tab === 'profile' ? (
        <Stack spacing={2}>
          <Section title="Contact details"><ProfileForm patientId={user.patientId} /></Section>
          <Section title="Insurance and HMO"><InsurancePolicies patientId={user.patientId} /></Section>
        </Stack>
      ) : (
        <QueryState query={chart}>
          {(c) => (
            <>
              {tab === 'health' && <ClinicalLists chart={c} patientId={user.patientId} canEdit="patient" />}
              {tab === 'visits' && <Section title="Visit notes from your doctors"><EncounterHistory encounters={c.encounters} /></Section>}
              {tab === 'labs' && <Section title="Lab results"><LabHistory orders={c.labOrders} /></Section>}
            </>
          )}
        </QueryState>
      )}
    </>
  );
}
