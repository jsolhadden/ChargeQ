# ChargeQ — Office EV Charger Waitlist

A real-time web app for managing a shared office EV charging queue. Employees join a FIFO waitlist, get auto-assigned to one of 2 chargers when available, and have 60 minutes to claim their spot before it passes to the next person.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/ev-charger run dev` — run the frontend (port 24813)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `RESEND_API_KEY` — Resend API key for assignment email notifications
- Auth env (auto-provisioned): `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind v4, Clerk auth, React Query, Wouter, Framer Motion
- API: Express 5 + Clerk Express middleware
- DB: PostgreSQL + Drizzle ORM
- Auth: Clerk (Replit-managed)
- Email: Resend (optional)
- Validation: Zod (v4 compat), drizzle-zod
- API codegen: Orval (from OpenAPI spec)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/` — DB tables: chargers, queue_entries, charging_sessions
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/queue.ts` — Queue assignment logic + background expiry jobs
- `artifacts/api-server/src/lib/email.ts` — Resend email notification
- `artifacts/ev-charger/src/` — React frontend (App.tsx, pages/, components/)

## Architecture decisions

- Orval v8 generates Zod v4 syntax (`z.int()`); the codegen script patches the import to `zod/v4` after generation via sed in `lib/api-spec/package.json`
- Auth is cookie-based on web (no Bearer tokens); Clerk session cookies are auto-attached to same-origin API calls
- Background jobs (claim expiry check every 2 min, end-of-day session expiry at 11:55 PM) run in the API server process via `setInterval`
- Queue assignment (`processQueue`) runs immediately on join and after any checkout/forfeit
- Chargers table is seeded with 2 rows (Charger A, Charger B) — the only seed data needed

## Product

- Employees sign in with email/password (Clerk)
- Dashboard shows live charger status + full queue with positions
- One-tap join / leave queue; auto-assigned when a charger frees up
- 60-minute claim countdown on My Spot page; auto-forfeit if unclaimed
- Check-in (parked + plugged in) and check-out (frees charger, triggers next assignment)
- End-of-day auto-expiry for forgotten sessions

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`
- After changing any `lib/*` package, run `pnpm run typecheck:libs` before checking artifact packages
- The codegen sed patch runs automatically as part of the codegen script — don't remove it
- Clerk dev keys show a console warning during development — this is expected and harmless
