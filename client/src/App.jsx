import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { LinearProgress } from '@mui/material';
import RequireAuth from './auth/RequireAuth.jsx';
import AppShell from './layout/AppShell.jsx';
import Login from './pages/auth/Login.jsx';
import Register from './pages/auth/Register.jsx';

// Route-level code splitting: patients never download the admin/report bundles
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Appointments = lazy(() => import('./pages/appointments/Appointments.jsx'));
const BookAppointment = lazy(() => import('./pages/appointments/BookAppointment.jsx'));
const Patients = lazy(() => import('./pages/patients/Patients.jsx'));
const PatientChart = lazy(() => import('./pages/patients/PatientChart.jsx'));
const MyRecords = lazy(() => import('./pages/patients/MyRecords.jsx'));
const Prescriptions = lazy(() => import('./pages/prescriptions/Prescriptions.jsx'));
const PrescriptionPad = lazy(() => import('./pages/prescriptions/PrescriptionPad.jsx'));
const Labs = lazy(() => import('./pages/labs/Labs.jsx'));
const Billing = lazy(() => import('./pages/billing/Billing.jsx'));
const Messages = lazy(() => import('./pages/messages/Messages.jsx'));
const Inventory = lazy(() => import('./pages/inventory/Inventory.jsx'));
const Reports = lazy(() => import('./pages/reports/Reports.jsx'));
const Admin = lazy(() => import('./pages/admin/Admin.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const VideoVisit = lazy(() => import('./pages/appointments/VideoVisit.jsx'));

const STAFF = ['doctor', 'admin', 'receptionist'];

export default function App() {
  return (
    <Suspense fallback={<LinearProgress />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<RequireAuth />}>
          <Route path="/visit/:appointmentId" element={<VideoVisit />} />
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="appointments" element={<Appointments />} />
            <Route path="appointments/book" element={<BookAppointment />} />
            <Route path="prescriptions" element={<Prescriptions />} />
            <Route path="prescriptions/:id" element={<PrescriptionPad />} />
            <Route path="billing" element={<Billing />} />
            <Route path="settings" element={<Settings />} />
            <Route element={<RequireAuth roles={['patient']} />}>
              <Route path="records" element={<MyRecords />} />
            </Route>
            <Route element={<RequireAuth roles={['patient', 'doctor']} />}>
              <Route path="messages" element={<Messages />} />
            </Route>
            <Route element={<RequireAuth roles={STAFF} />}>
              <Route path="patients" element={<Patients />} />
              <Route path="inventory" element={<Inventory />} />
            </Route>
            <Route element={<RequireAuth roles={['doctor']} />}>
              <Route path="patients/:id" element={<PatientChart />} />
            </Route>
            <Route element={<RequireAuth roles={['patient', 'doctor', 'admin']} />}>
              <Route path="labs" element={<Labs />} />
            </Route>
            <Route element={<RequireAuth roles={['admin', 'doctor']} />}>
              <Route path="reports" element={<Reports />} />
            </Route>
            <Route element={<RequireAuth roles={['admin']} />}>
              <Route path="admin" element={<Admin />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
