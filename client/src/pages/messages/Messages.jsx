import SendOutlined from '@mui/icons-material/SendOutlined';
import { Alert, Badge, Box, Button, IconButton, List, ListItemButton, ListItemText, MenuItem, Paper, Stack, TextField, Typography, useMediaQuery } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/endpoints.js';
import { errorMessage } from '../../api/http.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/common.jsx';
import { getSocket } from '../../hooks/useRealtime.js';
import { tokens } from '../../theme.js';
import { dateTime, time } from '../../utils/format.js';

const other = (c, me) => c.participants.find((p) => p.userId !== me) ?? {};

function Thread({ conversation, me }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const endRef = useRef(null);
  const id = conversation._id;
  const messages = useQuery({ queryKey: ['messages', id], queryFn: () => api.messages.list(id) });

  // Live delivery: append pushed messages for this thread straight into the cache
  useEffect(() => {
    api.messages.markRead(id).then(() => qc.invalidateQueries({ queryKey: ['conversations'] })).catch(() => {});
    const socket = getSocket();
    const onMessage = (m) => {
      if (m.conversationId !== id) return;
      qc.setQueryData(['messages', id], (old = []) => (old.some((x) => x._id === m._id) ? old : [...old, m]));
      api.messages.markRead(id).catch(() => {});
    };
    socket?.on('message', onMessage);
    return () => socket?.off('message', onMessage);
  }, [id, qc]);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [messages.data?.length]);

  const send = useMutation({
    mutationFn: () => api.messages.send(id, body.trim()),
    onSuccess: (m) => {
      setBody('');
      qc.setQueryData(['messages', id], (old = []) => [...old, m]);
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  return (
    <Stack sx={{ height: '100%' }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h3">{other(conversation, me).name}</Typography>
        <Typography variant="body2" color="text.secondary">For non-urgent questions. In an emergency, call 911 or go to the nearest hospital.</Typography>
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2, bgcolor: 'background.default' }} aria-live="polite">
        {(messages.data ?? []).map((m) => {
          const mine = m.from === me;
          return (
            <Box key={m._id} sx={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', mb: 1 }}>
              <Box sx={{ maxWidth: '75%', px: 1.5, py: 1, borderRadius: 2, bgcolor: mine ? tokens.rx : '#fff', color: mine ? '#fff' : 'text.primary', border: mine ? 0 : `1px solid ${tokens.line}` }}>
                <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</Typography>
                <Typography variant="caption" sx={{ opacity: 0.7 }} title={dateTime(m.createdAt)}>{time(m.createdAt)}</Typography>
              </Box>
            </Box>
          );
        })}
        <div ref={endRef} />
      </Box>
      <Stack direction="row" spacing={1} component="form" sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}
        onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(); }}>
        <TextField placeholder="Write a message" multiline maxRows={4} value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (body.trim()) send.mutate(); } }}
          slotProps={{ htmlInput: { maxLength: 4000, 'aria-label': 'Message' } }} />
        <IconButton type="submit" color="primary" aria-label="Send" disabled={!body.trim() || send.isPending}><SendOutlined /></IconButton>
      </Stack>
      {send.isError && <Alert severity="error">{errorMessage(send.error)}</Alert>}
    </Stack>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const narrow = useMediaQuery('(max-width:900px)');
  const [active, setActive] = useState(null);
  const [contact, setContact] = useState('');
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: api.messages.conversations, refetchInterval: 60_000 });
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: api.messages.contacts, staleTime: 5 * 60_000 });
  const open = useMutation({
    mutationFn: () => api.messages.open(contact),
    onSuccess: (c) => { setActive(c); setContact(''); qc.invalidateQueries({ queryKey: ['conversations'] }); },
  });

  const showList = !narrow || !active;
  return (
    <>
      <PageHeader title="Messages" subtitle={user.role === 'patient' ? 'Message doctors you have booked with.' : 'Conversations with your patients.'} />
      <Paper sx={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '320px 1fr', height: 'calc(100vh - 220px)', minHeight: 420, overflow: 'hidden' }}>
        {showList && (
          <Stack sx={{ borderRight: narrow ? 0 : 1, borderColor: 'divider', minHeight: 0 }}>
            <Stack direction="row" spacing={1} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <TextField select label={user.role === 'patient' ? 'New message to' : 'Message a patient'} value={contact} onChange={(e) => setContact(e.target.value)}>
                {(contacts.data ?? []).map((c) => <MenuItem key={c.user_id} value={c.user_id}>{c.name} ({c.detail})</MenuItem>)}
                {contacts.data?.length === 0 && <MenuItem disabled value="">No contacts yet</MenuItem>}
              </TextField>
              <Button variant="outlined" disabled={!contact || open.isPending} onClick={() => open.mutate()}>Open</Button>
            </Stack>
            {open.isError && <Alert severity="error">{errorMessage(open.error)}</Alert>}
            <List sx={{ overflowY: 'auto', flex: 1 }} disablePadding>
              {(conversations.data ?? []).map((c) => (
                <ListItemButton key={c._id} selected={active?._id === c._id} onClick={() => setActive(c)} divider>
                  <ListItemText
                    primary={other(c, user.id).name}
                    secondary={c.lastMessage?.preview ?? 'No messages yet'}
                    slotProps={{ secondary: { noWrap: true } }}
                  />
                  <Badge color="primary" badgeContent={c.unread} sx={{ ml: 2 }} />
                </ListItemButton>
              ))}
              {conversations.data?.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>No conversations yet.</Typography>}
            </List>
          </Stack>
        )}
        {active ? (
          <Box sx={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {narrow && <Button onClick={() => setActive(null)} sx={{ alignSelf: 'flex-start', m: 1 }}>Back to conversations</Button>}
            <Box sx={{ flex: 1, minHeight: 0 }}><Thread key={active._id} conversation={active} me={user.id} /></Box>
          </Box>
        ) : !narrow && (
          <Box sx={{ display: 'grid', placeItems: 'center', color: 'text.secondary' }}><Typography>Choose a conversation.</Typography></Box>
        )}
      </Paper>
    </>
  );
}
