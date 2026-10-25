import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints.js';
import { refreshSession, setAccessToken, setSessionEndHandler } from '../api/http.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const startSession = useCallback((session) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const endSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    queryClient.clear(); // drop cached patient data from memory on sign-out
    navigate('/login', { replace: true });
  }, [navigate, queryClient]);

  // Restore the session on page load using the httpOnly refresh cookie
  useEffect(() => {
    setSessionEndHandler(endSession);
    refreshSession().then(startSession).catch(() => {}).finally(() => setReady(true));
  }, [endSession, startSession]);

  const value = useMemo(
    () => ({
      user,
      ready,
      /** Returns { mfaToken } when a second factor is required. */
      async login(email, password) {
        const res = await api.auth.login({ email, password });
        if (res.mfaRequired) return { mfaToken: res.mfaToken };
        startSession(res);
        return {};
      },
      async verifyMfa(mfaToken, code) {
        startSession(await api.auth.verifyMfa({ mfaToken, code }));
      },
      async register(data) {
        startSession(await api.auth.register(data));
      },
      async logout() {
        await api.auth.logout().catch(() => {});
        endSession();
      },
      setUser,
    }),
    [user, ready, startSession, endSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
