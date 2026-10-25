import axios from 'axios';

// Access token lives only in memory (not localStorage) → XSS cannot lift it from storage.
// The refresh token is an httpOnly cookie the browser sends only to /api/auth.
let accessToken = null;
let onSessionEnd = () => {};

export const getAccessToken = () => accessToken;
export const setAccessToken = (t) => { accessToken = t; };
export const setSessionEndHandler = (fn) => { onSessionEnd = fn; };

export const http = axios.create({ baseURL: '/api', withCredentials: true, timeout: 20_000 });

http.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// On 401, refresh once (shared promise so parallel requests don't stampede), then replay
let refreshing = null;
export const refreshSession = () => {
  refreshing ??= axios.post('/api/auth/refresh', {}, { withCredentials: true }).then((r) => r.data).finally(() => { refreshing = null; });
  return refreshing;
};

http.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && !original.url.startsWith('/auth/')) {
      original._retry = true;
      try {
        const session = await refreshSession();
        setAccessToken(session.accessToken);
        return http(original);
      } catch {
        setAccessToken(null);
        onSessionEnd();
      }
    }
    return Promise.reject(error);
  }
);

export const errorMessage = (e) => e?.response?.data?.message ?? e?.message ?? 'Request failed';
export const fieldErrors = (e) => e?.response?.data?.details ?? {};
