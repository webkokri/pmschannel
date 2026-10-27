# Channel Manager

A **multi-tenant SaaS hospitality platform** for lodging operators in **Canada and the
USA** — a channel manager at its core (ingests bookings from every connected OTA,
prevents double-bookings, pushes availability/rates/restrictions back out to every other
channel), plus the property-management, revenue-management, finance, staff and guest
-facing modules a real operation needs around it. Hotel/property owners sign up, subscribe
to a plan, and get their own isolated workspace. A platform **super admin** has full
control over every tenant, every subscription plan, and the global OTA catalogue.

## Modules

| Area | What it does |
|---|---|
| **Channel manager** | OTA connections, ARI sync engine, conflict guard, booking simulator (see below) |
| **PMS** (front desk) | `/pms` — arrivals/departures/in-house board, check-in/out, room-unit housekeeping status |
| **RMS** (pricing) | `/rms` — rule-based auto-pricing (day-of-week, occupancy, lead-time, length-of-stay), nightly + on-demand, full change log |
| **CRS** | The channel-sync core already centralizes reservations across properties; `/api/bookings/calendar` surfaces it as one cross-property view |
| **Finance** | `/finance` — revenue by channel net of OTA commission, expense tracking, P&L |
| **Packages** | `/packages` — guest-facing bundles (room + add-ons) at a special rate |
| **Payments** | Guest charges/refunds against a booking via a pluggable gateway (Stripe by default) |
| **Notifications** | Email (SMTP) + SMS (Twilio) on booking confirmation/cancellation/overbooking, editable templates, send log |
| **Staff & roles** | `/staff` — profiles (title/department/phone) + a granular permission overlay on top of admin/manager/viewer |
| **General settings** | `/settings` → General — org profile: logo, brand color, tax ID, locale, invoice footer |
| **SEO / GEO / AEO** | `/seo` + a real public booking microsite at `/book/:code` — meta tags, `schema.org` LodgingBusiness/FAQPage structured data, sitemap |
| **Reports** | `/reports` — occupancy, revenue, booking-source, CSV export |
| **AI assistant** | Floating chat (Claude-backed) answering from a live data snapshot, plus AI pricing/occupancy suggestions on the RMS page |

Payments, notifications and AI all follow the same pattern: real integration code that's a
safe no-op ("not configured") until you add the relevant API key — see
[Optional integrations](#optional-integrations).

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

## Multi-tenant SaaS

Every tenant-owned table carries an `organizationId`; the OTA catalogue and `Plan`
catalogue are the only platform-global data. See [`shared/src/plan-catalog.ts`](shared/src/plan-catalog.ts)
for the seeded default packages — property count is the primary axis:

| | Starter | Growth | Enterprise |
|---|---|---|---|
| Properties | 1 | up to 3 | up to 25 |
| Channel connections | 3 | 10 | unlimited |
| Channel categories | direct + global | + North America | + GDS |
| Team members | 2 | 5 | 20 |

Limits are enforced server-side (`backend/src/lib/limits.ts`) at the moment an owner tries
to add a property/channel/user past their plan — the API returns `402` with a clear
"upgrade to X" message the frontend turns into an upgrade prompt (`components/ui.tsx`'s
`LimitBanner`). A super admin can override any organization's plan or status by hand at
any time from `/admin`, no payment required.

**Self-serve signup** (`/signup` → `POST /api/auth/signup`) creates an `Organization` + a
trial `Subscription` + the first admin `User` in one transaction, and auto-assigns a
**dedicated support manager** from the platform staff pool (least-loaded first —
`backend/src/lib/support.ts`), shown to the owner on their Billing page.

**Billing** (`backend/src/modules/billing.ts`) works with or without Stripe: downgrades
apply immediately; upgrades create a Stripe Checkout session when `STRIPE_SECRET_KEY` is
set, and otherwise are recorded as a pending request the super admin/support manager
actions manually (`backend/src/lib/stripe.ts` is a safe no-op until configured).

**Super admin** (`/admin`, gated by `User.isSuperAdmin`, no `organizationId`) has full
platform control: every organization (search, change plan/status, reassign support
manager, impersonate for support), the plan catalogue, the global OTA catalogue,
platform-wide settings and audit log, and the support-manager staff pool. Impersonation
issues a short-lived (30 min) token scoped to that organization so support can see exactly
what the owner sees.

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

| Email | Password | Access |
|---|---|---|
| `superadmin@channelmanager.local` | `superadmin12345` | platform super admin → `/admin` |
| `admin@channelmanager.local` | `admin12345` | "Demo Hotels" organization admin |
| `manager@channelmanager.local` | `manager12345` | "Demo Hotels" organization manager |

Or sign up a brand-new organization yourself at **/signup**.

### See it work

1. **Sign up** a new organization on the Starter plan, then try adding a 2nd property —
   blocked with an upgrade prompt (Starter allows 1). Add a 4th on Growth — same thing
   (Growth allows 3). Log in as the super admin, find the org under **Organizations**, and
   bump its plan — the limit lifts immediately.
2. **Simulator → Generate 20 bookings** across the connected mock channels. Watch
   *Bookings* fill, *Calendar* availability drop, and *Sync Logs* show availability
   pushes fanning out to the other channels.
3. **Simulator → Force an overbooking**. *Conflicts* gets a new `double_booking` /
   `overbooking` alert and the offending reservation is `rejected` (auto-protect).
4. **Simulator → Start autopilot** to have the worker's poll loop invent a steady
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

## Optional integrations

Every one of these ships as real, wired-up code that runs in a safe "not configured" mode
(clear message, nothing crashes, nothing silently pretends to succeed) until you add the
matching environment variable(s) to `.env`. Nothing else changes — same UI, same API.

| Feature | Env vars | Provider assumed |
|---|---|---|
| Guest payments | `STRIPE_SECRET_KEY` | Stripe (PaymentIntents) — `backend/src/lib/payments/` |
| Subscription billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe Checkout — `backend/src/lib/stripe.ts` |
| Email notifications | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Any SMTP provider (Postmark, SES, SendGrid SMTP, …) — `backend/src/lib/notify/email.ts` |
| SMS notifications | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Twilio — `backend/src/lib/notify/sms.ts` |
| AI assistant + suggestions | `ANTHROPIC_API_KEY` | Claude API — `backend/src/lib/ai/claude.ts` |

The AI assistant is answer-only over a data snapshot the backend assembles per request
(recent bookings, occupancy, open conflicts) — it has no path to a mutating database call,
by design; anything it suggests, staff action through the normal screens.

---

## Deployment (cloud)

**See [`DEPLOYMENT.md`](DEPLOYMENT.md)** for the full walkthrough — a `render.yaml`
Blueprint provisions a managed Postgres + the web service (API, and it also serves the
built admin panel — one deployable process) + a background worker in one pass on
[Render](https://render.com), plus generic Docker/Node instructions for any other host.

Prisma targets PostgreSQL, so production is the same schema with a different
`DATABASE_URL`. `npm run build` bundles the backend (shared code inlined, so
`node backend/dist/index.js` / `.../worker/index.js` run standalone with no workspace
symlinks needed) and builds the frontend to `frontend/dist`, which the API serves directly
when `NODE_ENV=production`.

A `docker-compose.yml` is included for running Postgres anywhere Docker is available.

Set real secrets in production: `JWT_SECRET`, `CM_SECRET` (32+ chars, encrypts channel
credentials at rest, identical across the web and worker processes), and optionally
`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` to turn on real billing.

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
