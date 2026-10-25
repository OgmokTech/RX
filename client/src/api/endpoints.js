// One place for every API call — components never build URLs themselves.
import { http } from './http.js';

const get = (url, params) => http.get(url, { params }).then((r) => r.data);
const post = (url, body, config) => http.post(url, body, config).then((r) => r.data);
const patch = (url, body) => http.patch(url, body).then((r) => r.data);
const put = (url, body) => http.put(url, body).then((r) => r.data);
const del = (url) => http.delete(url).then((r) => r.data);

export const api = {
  auth: {
    login: (b) => post('/auth/login', b),
    verifyMfa: (b) => post('/auth/mfa/verify', b),
    register: (b) => post('/auth/register', b),
    logout: () => post('/auth/logout'),
    mfaSetup: () => post('/auth/mfa/setup'),
    mfaEnable: (code) => post('/auth/mfa/enable', { code }),
  },
  doctors: {
    list: () => get('/doctors'),
    slots: (id, date) => get(`/doctors/${id}/slots`, { date }),
    dashboard: () => get('/doctors/me/dashboard'),
    schedule: () => get('/doctors/me/schedule'),
    saveSchedule: (blocks) => put('/doctors/me/schedule', { blocks }),
    addTimeOff: (b) => post('/doctors/me/time-off', b),
  },
  appointments: {
    list: (params) => get('/appointments', params),
    book: (b) => post('/appointments', b),
    reschedule: (id, startsAt) => patch(`/appointments/${id}/reschedule`, { startsAt }),
    setStatus: (id, b) => patch(`/appointments/${id}/status`, b),
  },
  patients: {
    search: (params) => get('/patients', params),
    get: (id) => get(`/patients/${id}`),
    create: (b) => post('/patients', b),
    update: (id, b) => patch(`/patients/${id}`, b),
    chart: (id) => get(`/patients/${id}/chart`),
    addAllergy: (id, b) => post(`/patients/${id}/allergies`, b),
    addMedication: (id, b) => post(`/patients/${id}/medications`, b),
    stopMedication: (id, medId) => patch(`/patients/${id}/medications/${medId}/stop`),
    addCondition: (id, b) => post(`/patients/${id}/conditions`, b),
    policies: (id) => get(`/patients/${id}/policies`),
    addPolicy: (id, b) => post(`/patients/${id}/policies`, b),
    removeAllergy: (id, allergyId) => del(`/patients/${id}/allergies/${allergyId}`),
  },
  encounters: { create: (b) => post('/encounters', b) },
  rx: {
    drugs: (q) => get('/drugs', { q }),
    pharmacies: () => get('/pharmacies'),
    check: (b) => post('/prescriptions/check', b),
    create: (b) => post('/prescriptions', b),
    list: (params) => get('/prescriptions', params),
    get: (id) => get(`/prescriptions/${id}`),
    setStatus: (id, status) => patch(`/prescriptions/${id}/status`, { status }),
  },
  labs: {
    tests: () => get('/lab-tests'),
    order: (b) => post('/lab-orders', b),
    list: (params) => get('/lab-orders', params),
    result: (orderId, itemId, b) => patch(`/lab-orders/${orderId}/items/${itemId}/result`, b),
  },
  billing: {
    list: (params) => get('/invoices', params),
    get: (id) => get(`/invoices/${id}`),
    create: (b) => post('/invoices', b),
    claim: (id, b) => post(`/invoices/${id}/claims`, b),
    decideClaim: (claimId, b) => patch(`/claims/${claimId}`, b),
    void: (id) => post(`/invoices/${id}/void`),
    pay: (id, b) => post(`/invoices/${id}/payments`, b, { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
  },
  inventory: {
    list: (params) => get('/inventory', params),
    create: (b) => post('/inventory', b),
    move: (id, b) => post(`/inventory/${id}/transactions`, b),
    history: (id) => get(`/inventory/${id}/transactions`),
  },
  messages: {
    contacts: () => get('/messages/contacts'),
    conversations: () => get('/messages/conversations'),
    open: (userId) => post('/messages/conversations', { userId }),
    list: (id, before) => get(`/messages/conversations/${id}/messages`, { before }),
    send: (id, body) => post(`/messages/conversations/${id}/messages`, { body }),
    markRead: (id) => patch(`/messages/conversations/${id}/read`),
  },
  notifications: { list: () => get('/notifications'), readAll: () => patch('/notifications/read-all') },
  telemedicine: {
    join: (appointmentId) => post(`/telemedicine/${appointmentId}/join`),
    leave: (appointmentId) => post(`/telemedicine/${appointmentId}/leave`),
  },
  reports: { summary: (params) => get('/reports/summary', params), refresh: () => post('/reports/refresh') },
  admin: {
    users: (params) => get('/admin/users', params),
    createUser: (b) => post('/admin/users', b),
    setActive: (id, isActive) => patch(`/admin/users/${id}/status`, { isActive }),
    auditLogs: (params) => get('/admin/audit-logs', params),
  },
  del,
};
