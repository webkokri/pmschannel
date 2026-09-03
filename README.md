# Channel Manager

A channel-manager automation platform for lodging operators in **Canada and the USA**.
It ingests bookings from every connected OTA, prevents double-bookings, and pushes
availability / rates / restrictions (ARI) back out to all the *other* channels so
inventory never drifts. Ships with an admin panel (dashboard, channel configuration,
ARI calendar, bookings, conflicts, sync logs) and a booking simulator.

> **OTA connectors** – real OTA APIs need signed partner agreements and credentials.
> This repo implements a **pluggable connector framework** with a fully working
> **mock driver** for every catalogued OTA plus a **booking simulator**, so the whole
> pipeline runs end-to-end today. Each real provider has a stub connector implementing
> the same interface, ready to be filled in (`backend/src/connectors/providers/`).

---

## Architecture

```
                    ┌──────────────────────────── Admin panel (React + Vite) ───────────────────────────┐
                    │  Dashboard · Channels · ARI Calendar · Bookings · Conflicts · Sync Logs · Simulator │
                    └───────────────────────────────────────┬───────────────────────────────────────────┘
                                                            │ REST /api  (JWT)
                    ┌───────────────────────────────────────▼───────────────────────────────────────────┐
                    │                           API  (Node + Express + Prisma)                          │
                    │                                                                                   │
   OTA webhook  ───►│  /api/webhooks/:channel ─► ingest ─► conflict guard ─► ARI recompute ─► fan-out ──┐│
                    │                                              │                                    ││
                    │  modules: properties · channels · calendar · bookings · conflicts · sync · sim    ││
                    └───────────────────────────────────────┬──────┼────────────────────────────────────┼┘
                                                            │      │                                   │
                                              ┌─────────────▼──┐   │        ┌──────────────────────────▼─────────┐
                                              │  PostgreSQL     │   │        │  SyncJob queue (DB-backed)          │
                                              │  (Prisma)       │   │        └──────────────┬─────────────────────┘
                                              └─────────────────┘   │                       │
                                                                    │      ┌────────────────▼────────────────┐
                                                        pull bookings│      │  Worker (node process)          │
                                                                    │      │   • drains SyncJobs w/ backoff   │
                                              ┌─────────────────────▼──────▼┐  • polls pull channels          │
                                              │   Connector framework       │  writes SyncLog per attempt     │
                                              │   registry → mock | real    └─────────────────────────────────┘
                                              │   MockConnector (dev)                                          │
                                              │   providers/* (real, stubbed)                                  │
                                              └───────────────────────────────────────────────────────────────┘
```

**Core flow – inbound booking → conflict guard → ARI fan-out**

1. A connector delivers a booking (`POST /api/webhooks/:channelCode`, or the worker polls a
   pull channel). Every inbound call is persisted to `WebhookEvent` for audit.
2. `engine/ingest.ts` dedupes on `(channel, externalRef)`, normalizes via the connector's
   `parseBooking`, and upserts `Booking` + `BookingNight` rows.
3. `engine/conflict.ts` compares committed room-nights against `RoomType.totalUnits`.
   Oversell → `ConflictAlert` (`overbooking` / `double_booking`); with **auto-protect** on the
   offending booking is `rejected` so it never consumes inventory. Price drift vs the calendar
   → low-severity `rate_mismatch`.
4. `engine/ari.ts` recomputes `CalendarDay.availableUnits` for the affected room/dates and
   enqueues one availability `SyncJob` per *other* enabled channel mapped to that room type.
5. The worker drains jobs, calls `connector.pushAri(...)`, writes a `SyncLog`, and retries
   failures with exponential backoff (30s → 2m → 10m → 30m → 1h → 2h) before marking them `dead`.

---

## Stack

| Layer | Choice |
|---|---|
| Backend | Node 20 · TypeScript · Express · Zod · Prisma |
| Database | PostgreSQL |
| Auth | JWT + bcrypt, roles `admin` / `manager` / `viewer` |
| Queue | DB-backed `SyncJob` table + in-process worker loop (no Redis) |
| Frontend | React 18 · Vite · Tailwind · React Router · TanStack Query · Recharts |
| Tests | Vitest (engine + worker, against a real Postgres) |

Monorepo via npm workspaces: [`shared/`](shared) (types + OTA catalogue), [`backend/`](backend), [`frontend/`](frontend).

---

## Quick start

Requires **Node 20+**. No Docker needed for local development — a real PostgreSQL is
started by an npm script.

```bash
cp .env.example .env
npm install

# terminal 1 — start a local PostgreSQL (embedded, data in ./.pgdata)
npm run db

# terminal 2 — generate client, migrate, seed
npm run setup

# terminal 3 — run API (:4000) + worker + admin panel (:5173)
npm run dev
```

Open **http://localhost:5173** and sign in:

| Email | Password | Role |
|---|---|---|
| `admin@channelmanager.local` | `admin12345` | admin |
| `manager@channelmanager.local` | `manager12345` | manager |

### See it work

1. **Simulator → Generate 20 bookings** across the connected mock channels. Watch
   *Bookings* fill, *Calendar* availability drop, and *Sync Logs* show availability
   pushes fanning out to the other channels.
2. **Simulator → Force an overbooking**. *Conflicts* gets a new `double_booking` /
   `overbooking` alert and the offending reservation is `rejected` (auto-protect).
3. **Simulator → Start autopilot** to have the worker's poll loop invent a steady
   stream of bookings; the dashboard updates live.

---

## Commands

| Command | What |
|---|---|
| `npm run db` / `npm run db:stop` | start/stop the local embedded PostgreSQL |
| `npm run setup` | install + `prisma generate` + `migrate deploy` + `seed` |
| `npm run dev` | API + worker + frontend together |
| `npm run seed` | reseed demo data |
| `npm test` | backend Vitest suite (needs `npm run db` running) |
| `npm run build` | build shared + backend (tsup) + frontend (vite) |
| `npm run -w backend prisma:studio` | browse the database |

---

## Deployment (cloud)

Prisma targets PostgreSQL, so production is the same schema with a different
`DATABASE_URL`.

```bash
# point at your managed Postgres
export DATABASE_URL="postgresql://user:pass@host:5432/channel_manager"
npm ci
npm run build
npm run -w backend prisma:migrate      # migrate deploy
npm run -w backend seed                 # first deploy only

node backend/dist/index.js              # API   (PORT, defaults 4000)
node backend/dist/worker/index.js       # worker (run as a separate process/service)
# serve frontend/dist as static files behind the API or a CDN
```

A `docker-compose.yml` is included for running Postgres anywhere Docker is available.

Set real secrets in production: `JWT_SECRET`, `CM_SECRET` (32+ chars, encrypts channel
credentials at rest).

---

## OTA catalogue

Defined once in [`shared/src/ota-catalog.ts`](shared/src/ota-catalog.ts) and seeded as
`Channel` rows. Covers the Canada/USA market across three groups:

- **Global** — Booking.com, Expedia Group (Expedia, Hotels.com, Vrbo, Orbitz, Travelocity),
  Airbnb, Agoda, Priceline, Hostelworld, Hopper, Google Hotel Ads, Tripadvisor/Viator
- **North America** — Sabre / Amadeus / Travelport GDS, RedAwning, Whimstay, CanadaStays,
  TravelNest, Booking.com Canada
- **Direct & other** — direct website booking engine, generic iCal, Vacasa, Sonder,
  Furnished Finder

### Writing a real connector

1. Copy `backend/src/connectors/providers/generic-provider.ts` (or the reference skeletons
   `booking-com-provider.ts` / `airbnb-provider.ts`).
2. Implement `testConnection`, `pushAri`, `fetchBookings` (and `parseWebhook` for
   webhook-driven OTAs) using `this.http(...)` and `ctx.credentials`.
3. Register it in `backend/src/connectors/providers/index.ts`.
4. On a `ChannelConnection`, set `credentials.driver = "real"` to switch that connection
   from the mock driver to your implementation.

The engine, queue, retry logic, conflict guard and admin panel are all driver-agnostic —
they only depend on the `Connector` interface in
[`backend/src/connectors/types.ts`](backend/src/connectors/types.ts).
