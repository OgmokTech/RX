import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken } from '../api/http.js';
import { useToast } from '../components/Toast.jsx';

let socket = null;
export const getSocket = () => socket;

/** One socket per signed-in session; pushes invalidate the right React Query caches. */
export function useRealtime(user) {
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (!user) return undefined;
    socket = io({ path: '/socket.io', auth: (cb) => cb({ token: getAccessToken() }) });
    socket.on('notification', (n) => {
      toast(n.title, 'info');
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (n.type?.startsWith('lab')) queryClient.invalidateQueries({ queryKey: ['labs'] });
      if (n.type?.startsWith('appointment')) queryClient.invalidateQueries({ queryKey: ['appointments'] });
    });
    socket.on('message', () => queryClient.invalidateQueries({ queryKey: ['conversations'] }));
    return () => {
      socket.disconnect();
      socket = null;
    };
  }, [user, queryClient, toast]);
}
