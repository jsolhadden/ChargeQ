# Threat Model

## Project Overview

ChargeQ is a Node.js/Express + React web app for managing a shared office EV charging queue. Employees sign in with Clerk (email/password), join a FIFO waitlist, and get auto-assigned to one of two chargers. The backend is Express 5 with Drizzle ORM on PostgreSQL; the frontend is React + Vite. Auth is cookie-based via Clerk. The app is not yet deployed (no active deployment at scan time).

## Assets

- **Employee identities and PII** — Clerk user IDs, names, and email addresses stored in queue entries and sessions. Exposure could reveal who is in the office, when, and their email.
- **Charger state** — real-time status of the two physical chargers and the queue. Manipulation could unfairly assign or block charger access.
- **Session integrity** — claim/checkin/checkout state transitions; unauthorized manipulation lets one user steal another's charger slot.
- **Application secrets** — `DATABASE_URL`, `CLERK_SECRET_KEY`, `RESEND_API_KEY`. Compromise allows full data access or impersonation.

## Trust Boundaries

- **Browser to API** — all requests cross this boundary. The API must authenticate and authorize every request; the browser is untrusted.
- **API to PostgreSQL** — direct Drizzle ORM access; SQL injection at the API layer gives full DB access.
- **API to Clerk** — Clerk middleware validates session cookies; the API must call `requireAuth` before acting on any user-identifying data.
- **API to Resend** — optional email notifications use a server-side API key; key leakage enables sending arbitrary emails from the registered domain.
- **Public vs. authenticated** — most routes require `requireAuth`; exceptions must be intentional and non-sensitive.

## Scan Anchors

- Production entry points: `artifacts/api-server/src/routes/` (all under `/api` prefix)
- Highest-risk areas: `routes/dashboard.ts` (unauthenticated endpoint), `app.ts` (CORS config), `routes/queue.ts` (PII in list response)
- Authenticated surface: all routes except `/api/healthz` and `/api/dashboard/summary`
- Dev/mockup: `artifacts/mockup-sandbox/` — design canvas, not production

## Threat Categories

### Spoofing

Clerk handles authentication. `requireAuth` middleware validates the session cookie on every sensitive route. The `/api/dashboard/summary` route is intentionally (or accidentally) unauthenticated; if accidental this is a broken access control issue. Webhook origin validation is not applicable (no webhooks received).

### Tampering

Session state transitions (claim, checkin, checkout) are enforced server-side and scoped to the requesting user's `userId`. Queue join validates the user is not already waiting or active. No client-supplied prices or roles exist.

### Information Disclosure

The `GET /api/queue` endpoint returns all waiting users' `userId`, `userName`, and `userEmail` to any authenticated user. The `GET /api/chargers` endpoint returns `currentUserId` and `currentUserName` for chargers in use. This leaks PII across employee boundaries. The `/api/dashboard/summary` endpoint is unauthenticated, exposing operational metrics to the internet.

The CORS policy (`origin: true, credentials: true`) reflects any request origin, allowing any website to make credentialed cross-origin requests to the API — a precondition for CSRF attacks.

### Denial of Service

No rate limiting exists on any endpoint. Background jobs run every 2 minutes (expiry check) and at 11:55 PM (end-of-day expiry); no external trigger. Unbounded join spam is constrained by the "already in queue" / "already active session" checks per user.

### Elevation of Privilege

No admin role exists yet. All authenticated users have equal access. Session operations (claim, checkin, checkout) are scoped to `req.userId` so cross-user session takeover is not possible via normal paths. The `processQueue` background logic runs server-side only.
