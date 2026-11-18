# Deploying Channel Manager

The app is one Node web service (API + the built admin panel), one Node background
worker (the sync engine), and a PostgreSQL database. This guide uses **Render**
because its free/low-cost tier covers all three and a `render.yaml` Blueprint in this
repo provisions everything in one pass — but the same three pieces run anywhere that
runs Node + Postgres (Railway, Fly.io, a VPS, etc.); see [Other hosts](#other-hosts).

## Option A — Render Blueprint (recommended, ~10 minutes)

1. **Push this repo to GitHub** if it isn't already.
2. **Create a Render account** at [render.com](https://render.com) and connect your
   GitHub account.
3. **New → Blueprint**, pick the `channelmanager` repo. Render reads
   [`render.yaml`](render.yaml) and shows you three resources it's about to create:
   - `channel-manager-db` — managed Postgres
   - `channel-manager-web` — the API + admin panel
   - `channel-manager-worker` — the sync engine
4. **Fill in the prompted secrets** (Render asks for these once, during creation —
   they're marked `sync: false` in `render.yaml`):
   - `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — a demo portfolio-wide admin login
     (only used if you also run the seed script; see step 6)
   - `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` — **your** super-admin login,
     the platform-owner account with full control
   - `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — leave blank to launch without guest
     card payments (staff record cash/bank-transfer payments manually instead); add these
     later to turn on real guest payments + Connect payouts, no code changes needed
   - On `channel-manager-worker`, `JWT_SECRET` and `CM_SECRET` are listed as
     `sync: false` because Render Blueprints can't share a `generateValue` between
     services — after the web service generates them, open it in the Render dashboard,
     copy the two values, and paste them into the worker service's environment too
     (both services must use the *same* values).
5. **Apply**. Render provisions the database, builds both services
   (`npm ci && npm run build`), runs `prisma migrate deploy` as the web service's
   pre-deploy step, and starts both.
6. **Seed the platform** (creates the default plans and your super-admin login — run
   this once): open the web service's **Shell** tab in the Render dashboard and run:
   ```bash
   npm run -w backend seed
   ```
   (Or skip this and just create your super admin directly with Prisma Studio /
   a one-off script — the seed script also creates demo properties/bookings you may not
   want in production.)
7. **Custom domain + TLS**: in the web service's **Settings → Custom Domains**, add
   your domain — Render provisions and renews the TLS certificate automatically.
8. Visit the web service's URL, sign in with your `SEED_SUPERADMIN_*` credentials at
   `/login`, and you land in the platform console at `/admin`. Add your real properties
   from **Properties** and assign each one its manager/owner — there's no signup flow;
   every account is created by the super admin.

### Updating

Every push to the connected branch rebuilds and redeploys both services automatically
(`prisma migrate deploy` runs safely on every deploy — it only applies new migrations).

## Option B — any Docker/Node host

The three pieces, with no Render-specific config:

```bash
# 1. Provision a PostgreSQL 14+ instance and note its connection string.

# 2. Build once
npm ci
npm run build            # builds shared, backend (bundled, dist/), and frontend (dist/)

# 3. Apply migrations, and seed if you want the demo data (first deploy only)
DATABASE_URL="postgresql://…" npm run -w backend prisma:migrate
DATABASE_URL="postgresql://…" npm run -w backend seed

# 4. Run the two processes (a process manager / systemd / a second container each)
DATABASE_URL="postgresql://…" JWT_SECRET="…" CM_SECRET="…" NODE_ENV=production \
  PORT=4000 node backend/dist/index.js          # serves the API + the built admin panel

DATABASE_URL="postgresql://…" JWT_SECRET="…" CM_SECRET="…" NODE_ENV=production \
  node backend/dist/worker/index.js             # the sync engine — must run continuously
```

`backend/dist/index.js` serves the built `frontend/dist` itself when `NODE_ENV=production`
(see `backend/src/app.ts`), so there's nothing extra to host for the admin panel — point
your reverse proxy / load balancer at the web process's `PORT` and you're done. Put a CDN
or reverse proxy (Cloudflare, nginx, Render/Railway's built-in one) in front for TLS.

`docker-compose.yml` in this repo runs just the Postgres piece, for local/self-hosted use
without the embedded-postgres dev script — pair it with the `node backend/dist/*` commands
above for a fully self-hosted, Render-free setup.

## Environment variables reference

See [`.env.example`](.env.example) for the full list with comments. The ones that matter
in production:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Your Postgres connection string |
| `JWT_SECRET` | yes | Long random string — must be identical across the web and worker processes |
| `CM_SECRET` | yes | 32+ chars — encrypts channel credentials at rest; identical across both processes |
| `PUBLIC_API_URL` | yes | The web service's public URL — used to build webhook URLs shown in Channels |
| `PUBLIC_APP_URL` | yes | Same URL in production (one process serves both) |
| `SEED_SUPERADMIN_EMAIL` / `_PASSWORD` | first deploy | Your platform-owner login, created by `npm run seed` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | optional | Turns on real guest payments + Connect payouts (see [`backend/src/lib/payments/`](backend/src/lib/payments)) — omit to run with cash/manual payment recording only |

## Post-launch checklist

- [ ] Sign in as super admin (`/login` → `/admin`), add your real properties under
      **Properties**, and assign each one its dedicated manager/owner.
- [ ] Set the commission rate that applies to guest payments (**Properties** card, or the
      platform default under **Platform Settings**) — 0% to 100%, in-house, no billing tier.
- [ ] Decide on Stripe now or later — the app works fully without it (cash/manual payment
      recording via staff), so this is never a launch blocker.
- [ ] Point your domain's DNS at the web service and confirm TLS is active.
- [ ] Remove the seeded demo properties/bookings before onboarding real guests, if you ran
      the full seed script in production.
