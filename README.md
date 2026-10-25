# RX Clinic Information System

A web application for a doctor–patient clinic: online booking, medical records, e-prescriptions with drug-safety checks, lab orders, billing with GCash/Maya, secure messaging, video visits, inventory and reports.

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 6, Material UI 7, TanStack Query, React Router 7, Recharts |
| Backend | Node.js 20+, Express 5, Zod, Socket.IO, BullMQ |
| Data | PostgreSQL 16 (clinical and financial data), MongoDB 7 (audit, messages, notifications), Redis 7 (cache, locks, sessions, queues) |

Project documents:

- [`docs/01-project-plan.md`](docs/01-project-plan.md): SDLC project plan and assessment (scope, requirements, WBS, timeline, risks, testing, deployment, Data Privacy Act compliance, KPIs)
- [`docs/02-database-design.md`](docs/02-database-design.md): ERD, why three databases, integrity rules, index strategy, Redis key map

---

## 1. What you need

| Tool | Version | Check with |
|---|---|---|
| Node.js | 20 or newer (22 LTS recommended) | `node -v` |
| Docker Desktop | Any recent version | `docker compose version` |
| Git | Any | `git --version` |
| VSCode | Any recent version | |

Docker runs PostgreSQL, MongoDB and Redis for you, so you don't install any database directly. (If you prefer native installs, use the same versions and the connection strings in `server/.env`.)

## 2. Open the project in VSCode

1. Unzip `rx-clinic.zip` and open the `rx-clinic` folder: **File → Open Folder…**
2. VSCode shows a pop-up **"Do you want to install the recommended extensions?"** Choose **Install**. They are listed in `.vscode/extensions.json`:
   - ESLint and Prettier (formatting on save)
   - Docker (see containers in the sidebar)
   - SQLTools + PostgreSQL driver (browse tables; a connection named *RX Clinic (local)* is preconfigured)
   - MongoDB for VSCode (browse audit logs and messages)
   - REST Client (run requests from `api.http`)
   - Markdown Mermaid (renders the diagrams in `docs/`)
3. Open a terminal: **Terminal → New Terminal** (`` Ctrl+` ``).

## 3. First-time setup

Run these from the project root, in order.

**Step 1: start the databases**

```bash
docker compose up -d
docker compose ps        # wait until all three show "healthy"
```

**Step 2: configure the API**

```bash
cd server
cp .env.example .env     # Windows PowerShell: Copy-Item .env.example .env
```

Generate your own secrets and paste them into `server/.env`:

```bash
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

> **Keep `ENCRYPTION_KEY` safe.** Clinical notes, messages and insurance numbers are encrypted with it. If it is lost, that data cannot be recovered. Never commit `.env` (it is already in `.gitignore`).

**Step 3: install packages, create tables, load sample data**

```bash
npm install
npm run db:migrate       # creates tables, constraints, triggers, indexes, report views
npm run db:seed          # sample doctors, patients, drugs, lab tests, pharmacies, stock
npm test                 # optional: 13 unit tests should pass
```

**Step 4: install the web client**

```bash
cd ../client
npm install
```

## 4. Run the application

You need three processes. Open three terminals (click **+** in the terminal panel, or split with `Ctrl+Shift+5`).

| Terminal | Folder | Command | What it is |
|---|---|---|---|
| 1 | `server` | `npm run dev` | API on http://localhost:5000, restarts on file save |
| 2 | `server` | `npm run worker` | Background jobs: emails/SMS, reminders, pharmacy sending, report refresh |
| 3 | `client` | `npm run dev` | Web app on **http://localhost:5173** |

Open **http://localhost:5173** in your browser.

**Or use the debugger:** open **Run and Debug** (`Ctrl+Shift+D`), pick **Full stack**, press **F5**. This starts the API, the worker and the web client, and opens Chrome with breakpoints working in both server and React code.

Useful tasks (**Terminal → Run Task…**): `infra: up`, `install: all`, `db: migrate + seed`, `server: test`, `client: build`.

### Sample accounts

All seeded accounts use the password **`Clinic2026!Pass`**.

| Role | Email | Try this |
|---|---|---|
| Admin | `admin@rxclinic.local` | Create a staff account, view the audit log, see clinic reports |
| Receptionist | `reception@rxclinic.local` | Register a walk-in, book for a patient, bill a senior citizen, record cash payment |
| Doctor | `dr.reyes@rxclinic.local` | Open Juan's chart, try prescribing amoxicillin (blocked: penicillin allergy) |
| Doctor | `dr.garcia@rxclinic.local` | Set clinic hours in Account settings |
| Patient | `juan@example.com` | Book a video visit, pay a bill with GCash (mock), message the doctor |
| Patient | `ana@example.com` | Register allergies, add a PhilHealth card |

Emails and SMS are printed in the worker terminal until you fill in `SMTP_URL` or the Twilio settings in `.env`. Online payments use a mock gateway in development; no money moves.

## 5. Project structure

```
rx-clinic/
├── docker-compose.yml          PostgreSQL, MongoDB, Redis for development
├── api.http                    Sample API requests (REST Client extension)
├── docs/                       Project plan and database design
├── .vscode/                    Extensions, debug configs, tasks, SQLTools connection
├── server/
│   ├── src/
│   │   ├── app.js              Express app: security headers, CORS, routes
│   │   ├── server.js           HTTP + Socket.IO startup, graceful shutdown
│   │   ├── config/             Validated environment (zod), logger
│   │   ├── db/                 Connections, migrations/*.sql, migrate.js, seed.js
│   │   ├── middleware/         auth (JWT + RBAC), validate, audit, rateLimit, errorHandler
│   │   ├── models/             MongoDB schemas (audit, messages, notifications, video)
│   │   ├── modules/            One folder per feature: routes (+ service where logic is heavy)
│   │   │   ├── auth/  patients/  records/  doctors/  appointments/
│   │   │   ├── prescriptions/  labs/  billing/  inventory/
│   │   │   └── messages/  telemedicine/  notifications/  reports/  admin/
│   │   ├── jobs/               BullMQ queue, worker, email/SMS notifier
│   │   ├── sockets/            Real-time push to browsers
│   │   └── utils/              encryption, cache helpers, pagination, HTTP errors
│   └── tests/                  Unit tests for business rules
└── client/
    └── src/
        ├── api/                Axios instance (token refresh) and every API call
        ├── auth/               Session context and route guards
        ├── components/         Shared UI (tables, slot picker, patient search, toasts)
        ├── hooks/              Real-time socket, debounce
        ├── layout/             App shell with role-based navigation
        ├── pages/              One folder per feature
        └── theme.js            Colors, typography, print styles
```

**How a request flows** (booking example): `BookAppointment.jsx` → `api.appointments.book()` → `POST /api/appointments` → `authenticate` → `validate` (zod) → `appointments.service.book()` → Redis lock → PostgreSQL insert (exclusion constraint guards double-booking) → cache invalidation → queue confirmation + reminder jobs → worker sends email/SMS and pushes an in-app notification over Socket.IO.

## 6. API overview

All endpoints are under `/api` and need `Authorization: Bearer <accessToken>` except sign-up, sign-in and refresh. Errors return `{ message, details? }`; validation errors (422) put field messages in `details`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/mfa/verify`, `/auth/refresh`, `/auth/logout`, `/auth/mfa/setup`, `/auth/mfa/enable`, `GET /auth/me` |
| Doctors | `GET /doctors`, `GET /doctors/:id/slots?date=`, `GET /doctors/me/dashboard`, `GET·PUT /doctors/me/schedule`, `POST /doctors/me/time-off` |
| Appointments | `GET·POST /appointments`, `PATCH /appointments/:id/reschedule`, `PATCH /appointments/:id/status` |
| Patients | `GET·POST /patients`, `GET·PATCH /patients/:id`, `GET /patients/:id/chart` |
| Records | `POST /patients/:id/allergies`, `/medications`, `/conditions`, `PATCH …/medications/:id/stop`, `POST /encounters` |
| Prescriptions | `GET /drugs?q=`, `GET /pharmacies`, `POST /prescriptions/check`, `GET·POST /prescriptions`, `GET /prescriptions/:id`, `PATCH /prescriptions/:id/status` |
| Labs | `GET /lab-tests`, `GET·POST /lab-orders`, `PATCH /lab-orders/:id/items/:itemId/result` |
| Billing | `GET·POST /invoices`, `GET /invoices/:id`, `POST /invoices/:id/payments` (send `Idempotency-Key`), `POST /invoices/:id/void`, `POST /invoices/:id/claims`, `PATCH /claims/:id`, `GET·POST /patients/:id/policies` |
| Inventory | `GET·POST /inventory`, `PATCH /inventory/:id`, `GET·POST /inventory/:id/transactions` |
| Messages | `GET /messages/contacts`, `GET·POST /messages/conversations`, `GET·POST /messages/conversations/:id/messages`, `PATCH …/read` |
| Telemedicine | `POST /telemedicine/:appointmentId/join`, `/leave` |
| Reports | `GET /reports/summary?from=&to=`, `POST /reports/refresh` |
| Admin | `GET·POST /admin/users`, `PATCH /admin/users/:id/status`, `GET /admin/audit-logs` |
| Notifications | `GET /notifications`, `PATCH /notifications/read-all` |

Open `api.http` and click **Send Request** above any request to try it.

## 7. Security in brief

- Passwords hashed with bcrypt; 5 failed sign-ins lock the account for 15 minutes; auth routes are rate limited.
- Access tokens live 15 minutes and are kept in memory only. The refresh token is an httpOnly, SameSite=Strict cookie that rotates on every use; reusing an old one signs the user out everywhere.
- Two-factor authentication (authenticator app) for every role.
- Role-based access on every endpoint. Doctors only see patients who have booked with them; front-desk staff never see clinical notes.
- Clinical notes, messages, 2FA secrets and insurance numbers encrypted with AES-256-GCM.
- Every view or change of patient data is written to an audit log (who, what, when, from where).
- All SQL is parameterized; all input is validated with zod; Helmet sets security headers.

## 8. Build for production

```bash
cd client && npm run build          # static files in client/dist
cd ../server && NODE_ENV=production npm start
NODE_ENV=production npm run worker
```

Serve `client/dist` with Nginx and proxy `/api` and `/socket.io` to port 5000 over HTTPS. Set `CLIENT_ORIGIN` to your real domain, use strong secrets, and plug in a real payment gateway (PayMongo or Xendit) and SMS provider. Section 6 of `docs/01-project-plan.md` covers servers, backups and monitoring.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 5432` / `27017` / `6379` | Databases not running: `docker compose up -d`, then `docker compose ps` |
| Port 5432 already in use | A local PostgreSQL is running. Stop it, or change the left side of `"5432:5432"` in `docker-compose.yml` and `DATABASE_URL` to match |
| API exits with "Invalid environment" | A value in `server/.env` is missing or too short; the message names it |
| `ENCRYPTION_KEY` error | It must be exactly 64 hexadecimal characters |
| Sign-in works but you are signed out on refresh | Open the app on `http://localhost:5173` (not `127.0.0.1`) so the cookie domain matches |
| No time slots when booking | The doctor has no clinic hours that weekday. Sign in as the doctor and add hours in **Account settings** |
| Want a clean database | `docker compose down -v` (deletes data), then `docker compose up -d` and run migrate + seed again |
