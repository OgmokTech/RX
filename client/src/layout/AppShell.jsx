import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import BiotechOutlined from '@mui/icons-material/BiotechOutlined';
import ChatOutlined from '@mui/icons-material/ChatOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';
import FolderSharedOutlined from '@mui/icons-material/FolderSharedOutlined';
import GroupOutlined from '@mui/icons-material/GroupOutlined';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import ManageAccountsOutlined from '@mui/icons-material/ManageAccountsOutlined';
import MedicationOutlined from '@mui/icons-material/MedicationOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import { Badge, Box, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Typography, useMediaQuery } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useRealtime } from '../hooks/useRealtime.js';
import { tokens } from '../theme.js';
import { dateTime } from '../utils/format.js';

const DRAWER = 248;

// Navigation per role — mirrors the RBAC matrix enforced by the API
const NAV = [
  { to: '/', label: 'Home', icon: HomeOutlined, roles: ['patient', 'doctor', 'admin', 'receptionist'] },
  { to: '/appointments', label: 'Appointments', icon: EventOutlined, roles: ['patient', 'doctor', 'admin', 'receptionist'] },
  { to: '/records', label: 'My health record', icon: FolderSharedOutlined, roles: ['patient'] },
  { to: '/patients', label: 'Patients', icon: GroupOutlined, roles: ['doctor', 'admin', 'receptionist'] },
  { to: '/prescriptions', label: 'Prescriptions', icon: MedicationOutlined, roles: ['patient', 'doctor'] },
  { to: '/labs', label: 'Lab results', icon: BiotechOutlined, roles: ['patient', 'doctor', 'admin'] },
  { to: '/billing', label: 'Billing', icon: ReceiptLongOutlined, roles: ['patient', 'admin', 'receptionist', 'doctor'] },
  { to: '/messages', label: 'Messages', icon: ChatOutlined, roles: ['patient', 'doctor'] },
  { to: '/inventory', label: 'Inventory', icon: Inventory2Outlined, roles: ['admin', 'receptionist', 'doctor'] },
  { to: '/reports', label: 'Reports', icon: AssessmentOutlined, roles: ['admin', 'doctor'] },
  { to: '/admin', label: 'Users & audit', icon: ManageAccountsOutlined, roles: ['admin'] },
  { to: '/settings', label: 'Account settings', icon: SettingsOutlined, roles: ['patient', 'doctor', 'admin', 'receptionist'] },
];

function Nav({ role, onNavigate }) {
  return (
    <Box sx={{ height: '100%', bgcolor: tokens.ink, color: '#fff', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" spacing={1.25} sx={{ px: 2.5, py: 2.5, alignItems: 'center' }}>
        <Box sx={{ width: 34, height: 34, borderRadius: 1.5, bgcolor: tokens.rx, display: 'grid', placeItems: 'center', fontFamily: tokens.serif, fontSize: 22 }} aria-hidden>℞</Box>
        <Typography sx={{ fontWeight: 700, fontSize: '1.05rem' }}>RX Clinic</Typography>
      </Stack>
      <List component="nav" aria-label="Main" sx={{ px: 1, flex: 1 }}>
        {NAV.filter((n) => n.roles.includes(role)).map(({ to, label, icon: Icon }) => (
          <ListItemButton
            key={to} component={NavLink} to={to} end={to === '/'} onClick={onNavigate}
            sx={{
              borderRadius: 1, mb: 0.25, color: 'rgba(255,255,255,0.78)',
              '&.active': { bgcolor: 'rgba(255,255,255,0.1)', color: '#fff', boxShadow: `inset 3px 0 0 ${tokens.rx}` },
              '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}><Icon fontSize="small" /></ListItemIcon>
            <ListItemText primary={label} slotProps={{ primary: { fontSize: '0.9rem', fontWeight: 500 } }} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}

function Notifications() {
  const [anchor, setAnchor] = useState(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: api.notifications.list, refetchInterval: 120_000 });
  const readAll = useMutation({ mutationFn: api.notifications.readAll, onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return (
    <>
      <IconButton aria-label={`Notifications, ${data?.unread ?? 0} unread`} onClick={(e) => { setAnchor(e.currentTarget); if (data?.unread) readAll.mutate(); }}>
        <Badge badgeContent={data?.unread} color="error"><NotificationsOutlined /></Badge>
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { width: 340, maxHeight: 420 } } }}>
        {!data?.items?.length && <MenuItem disabled>No notifications yet</MenuItem>}
        {data?.items?.map((n) => (
          <MenuItem key={n._id} onClick={() => { setAnchor(null); if (n.link) navigate(n.link); }} sx={{ whiteSpace: 'normal', alignItems: 'flex-start', flexDirection: 'column' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{n.title}</Typography>
            <Typography variant="body2" color="text.secondary">{n.body}</Typography>
            <Typography variant="caption" color="text.secondary">{dateTime(n.createdAt)}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const desktop = useMediaQuery('(min-width:900px)');
  const [open, setOpen] = useState(false);
  useRealtime(user);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer
        variant={desktop ? 'permanent' : 'temporary'} open={desktop || open} onClose={() => setOpen(false)}
        sx={{ width: DRAWER, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER, border: 0 }, '@media print': { display: 'none' } }}
      >
        <Nav role={user.role} onNavigate={() => setOpen(false)} />
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" sx={{ px: { xs: 2, md: 4 }, py: 1.5, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', '@media print': { display: 'none' } }}>
          {!desktop ? <IconButton aria-label="Open menu" onClick={() => setOpen(true)}><MenuIcon /></IconButton> : <span />}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Notifications />
            <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{user.role === 'doctor' ? 'Dr. ' : ''}{user.firstName} {user.lastName}</Typography>
              <Typography variant="caption" color="text.secondary">{user.role === 'receptionist' ? 'Front desk' : user.role[0].toUpperCase() + user.role.slice(1)}</Typography>
            </Box>
            <IconButton aria-label="Sign out" onClick={logout}><LogoutOutlined /></IconButton>
          </Stack>
        </Stack>
        <Box component="main" sx={{ px: { xs: 2, md: 4 }, py: 4, maxWidth: 1200 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
