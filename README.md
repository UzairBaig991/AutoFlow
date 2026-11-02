# AutoFlow

AutoFlow is a visual business workflow automation platform for small businesses. It includes an authenticated dashboard, a React Flow workflow editor, a database-backed execution engine, run history, analytics, generated tasks, and in-app notifications.

## Stack

- Frontend: React, TypeScript, Vite, React Router, TanStack Query, React Flow, Recharts
- Backend: Express, TypeScript, Zod validation, cookie-based JWT authentication
- Data: Prisma + SQLite for local development
- Test: Vitest + Supertest

## Quick start

### 1. Install dependencies

```bash
npm install
npm --prefix apps/client install
npm --prefix server install
```

### 2. Apply database migrations

```bash
cd server
npx prisma migrate dev
cd ..
```

### 3. Start local services

```bash
npm run dev
```

The frontend runs on `http://localhost:5173` and the API on `http://localhost:4000`. Vite proxies `/api` requests to the backend during development.

Open the frontend and register a new account. Registration creates a local workspace. From the dashboard, create a workflow, adjust nodes and their settings, connect the nodes, save, validate, and run it. The default sample flow creates a task and an in-app notification. Execution results appear under **Execution history**, and actual run records power the dashboard and analytics.

## Backend notes

The backend uses SQLite for a self-contained local setup. The database includes users, revocable sessions, external identity accounts, workspaces, expiring invitations, workflow versions/runs/logs, tasks, notifications, and audit records. Copy `server/.env.example` to `server/.env` before migrating if you need to customize the local database path or OAuth settings.

```bash
cd server
npx prisma migrate dev
```

Set a unique `JWT_SECRET` of at least 32 characters before production use. Sessions are stored in the database and revoked on logout; passwords require at least 12 characters and are hashed with bcrypt. Authentication endpoints have a dedicated rate limit and unsafe browser requests are checked against the configured client origin.

Email/password signup works out of the box. Google and GitHub sign-in appear after their client ID and secret are configured. Add the exact callback URLs `http://localhost:4000/api/auth/oauth/google/callback` and/or `http://localhost:4000/api/auth/oauth/github/callback` to the corresponding provider console, then set the matching `*_CLIENT_ID` and `*_CLIENT_SECRET` values and `SERVER_URL`. Only providers with both credentials are enabled. OAuth signup requires a verified provider email.

Workspace owners can create single-use, seven-day invitation links under **Tasks & administration**. New users must register with the invited email; existing users can sign in and accept the invitation from its link. Invitation tokens are stored as hashes.

The schema stores JSON-shaped workflow definitions and execution data as serialized strings because the selected SQLite connector does not support Prisma JSON fields. For production deployment, use PostgreSQL, secure provider credentials, HTTPS, and a production-grade secret/session configuration.

## Useful commands

```bash
npm run dev
npm run build
npm test
```

The API health check is available at `http://localhost:4000/api/health`.

## Implemented API areas

- `/api/auth` — register, login, logout, current user
- `/api/workflows` — create/list/update/delete, validate, publish, and run workflows
- `/api/runs` — execution history, details, logs, retry
- `/api/analytics` — real workspace metrics and execution series
- `/api/tasks` and `/api/notifications` — generated work and in-app updates
- `/api/admin/summary` — workspace summary for owners/admins

## Security and development limitations

- Authentication is an HTTP-only JWT cookie; configure a unique `JWT_SECRET` and HTTPS for production.
- The initial local version does not implement CSRF tokens, external-service credentials, scheduled execution, webhook triggers, or Socket.IO monitoring.
- Workflow execution is bounded to 100 nodes and delay actions are limited to 2 seconds. Cycles are rejected.
- SQLite is for local demonstration and does not provide production workspace collaboration guarantees.

## Project structure

- `apps/client` — frontend application
- `server` — backend API and database layer

## Development progress

See `DEVELOPMENT_PROGRESS.md` for the latest status.
