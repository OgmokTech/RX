import { Autocomplete, TextField } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/endpoints.js';
import { useDebounced } from '../hooks/useDebounced.js';

/** Debounced server-side patient search (name, MRN or mobile) for staff workflows. */
export default function PatientPicker({ value, onChange, label = 'Patient' }) {
  const [input, setInput] = useState('');
  const search = useDebounced(input, 300);
  const q = useQuery({ queryKey: ['patients', 'search', search], queryFn: () => api.patients.search({ search, pageSize: 10 }), enabled: search.length >= 2 });
  return (
    <Autocomplete
      options={q.data?.data ?? []} value={value} onChange={(_e, v) => onChange(v)} onInputChange={(_e, v) => setInput(v)}
      getOptionLabel={(p) => `${p.last_name}, ${p.first_name} (${p.mrn})`} isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(x) => x} loading={q.isFetching} noOptionsText={search.length < 2 ? 'Type 2+ letters, an MRN or a phone number' : 'No match'}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}

