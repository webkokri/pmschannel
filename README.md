# Channel Manager

A **single-portfolio hospitality platform** for an in-house group of lodging properties
in **Canada and the USA** — a channel manager at its core (ingests bookings from every
connected OTA, prevents double-bookings, pushes availability/rates/restrictions back out
to every other channel), plus the property-management, revenue-management, finance,
staff and guest-facing modules a real operation needs around it. The admin adds every
property directly and assigns each one a dedicated manager/owner whose account is
hard-restricted to just that property — nothing else in the portfolio. A platform
**super admin** has full control over the whole portfolio and the global OTA catalogue.

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

## Single portfolio, property-scoped managers

There is exactly one `Organization` row — the portfolio — created transparently the
first time it's needed (`backend/src/lib/portfolio.ts`); there's no self-serve signup and
nothing to subscribe to. The super admin manages **Properties** directly from `/admin`:
add a property with no count limit, and assign each one a dedicated manager/owner.

That assignment (`User.assignedPropertyId`) is a **hard access boundary**, not a label.
Every property-scoped route (bookings, calendar, finance, PMS, RMS, packages, reports,
SEO, the page builder, dashboard, …) rejects access to any other property's data for that
user — see `backend/src/lib/tenant.ts`'s `assertPropertyInScope` / `resolvePropertyFilter`
/ `assertOwned`, applied consistently across `backend/src/modules/*`. Portfolio-wide
surfaces that aren't about any one property (staff management, org branding, the payment
gateway/Stripe Connect setup) are blocked for a scoped manager regardless of role rank
(`requirePortfolioStaff`).

**Commission**: the per-booking platform cut (`Organization.commissionRateBps`) is a
revenue-share concern, not SaaS billing, and stays — admin-settable from 0% to 100%
(`/admin` → **Properties**, or the platform default under **Platform Settings**).

**Super admin** (`/admin`, gated by `User.isSuperAdmin`, no `organizationId`) manages
every property and its assigned manager, the commission rate and Accelerator (now a
free, admin-triggered feature — no Stripe checkout), the global OTA catalogue,
platform-wide settings and the audit log. Impersonating a property opens a short-lived
(30 min) token signed in as its assigned manager, so support can see exactly what they see.

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
| `admin@channelmanager.local` | `admin12345` | portfolio-wide admin (sees every property) |
| `manager@channelmanager.local` | `manager12345` | portfolio-wide manager |
| `seaside.manager@channelmanager.local` | `property12345` | hard-scoped to the Seaside property only |
| `alpine.manager@channelmanager.local` | `property12345` | hard-scoped to the Alpine property only |
| `downtown.manager@channelmanager.local` | `property12345` | hard-scoped to the Downtown property only |

### See it work

1. Log in as a `*.manager@channelmanager.local` property manager — the property switcher
   in the header is locked to just that one property, and **Staff** is hidden from the nav.
   Open devtools and try `GET /api/properties/<another property's id>` with that same
   token — it 404s, same as it would for a property that doesn't exist.
2. Log in as the **super admin** → **Properties**: add a new property (no count limit),
   then **assign** it a manager — either an existing unassigned staff member or a brand
   new account created on the spot.
3. **Simulator → Generate 20 bookings** across the connected mock channels (log in as a
   portfolio-wide admin/manager first, or a property manager to generate for just theirs).
   Watch *Bookings* fill, *Calendar* availability drop, and *Sync Logs* show availability
   pushes fanning out to the other channels.
4. **Simulator → Force an overbooking**. *Conflicts* gets a new `double_booking` /
   `overbooking` alert and the offending reservation is `rejected` (auto-protect).
5. **Simulator → Start autopilot** to have the worker's poll loop invent a steady
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
| Guest payments + payout | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe (PaymentIntents + Connect) — `backend/src/lib/payments/`, `backend/src/lib/connect.ts` |
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
`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` to turn on real guest payments and payouts.

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
