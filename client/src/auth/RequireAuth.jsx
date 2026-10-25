import { Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

/** Guards a route subtree. `roles` limits it further (UX only — the API enforces RBAC). */
export default function RequireAuth({ roles }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <CircularProgress aria-label="Loading session" />
      </Box>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
