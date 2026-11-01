# AutoFlow

AutoFlow is a visual business workflow automation platform for small businesses. The project includes a React + Vite frontend and a TypeScript Express + Prisma backend with SQLite for local development.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind-ready styling
- Backend: Express, TypeScript, Zod validation
- Data: Prisma + SQLite for local development
- Test: Vitest + Supertest

## Quick start

### 1. Install dependencies

```bash
npm install
npm --prefix apps/client install
npm --prefix server install
```

### 2. Start local services

```bash
npm run dev
```

The frontend runs on `http://localhost:5173` and the API on `http://localhost:4000`.

## Backend notes

The backend uses a local SQLite database. Update `server/.env` as needed and run:

```bash
cd server
npx prisma migrate dev
```

## Project structure

- `apps/client` — frontend application
- `server` — backend API and database layer

## Development progress

See `DEVELOPMENT_PROGRESS.md` for the latest status.
