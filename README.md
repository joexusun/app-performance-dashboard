# Performance Dashboard

Local-first admin dashboard for Puzzle Canvas, Savory Advisor, and Receipt Cam.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Fill in the dedicated dashboard Firebase service account.
3. Enable Firebase Authentication > Phone in the dashboard Firebase project.
4. Create a Firebase Web app, add `localhost` as an authorized Auth domain, and fill in the `NEXT_PUBLIC_DASHBOARD_FIREBASE_*` values.
5. Set `DASHBOARD_ALLOWED_PHONE_NUMBERS` to the admin phone number(s), including country code.
6. Fill in each app's source Firebase service account and Firestore mapping.
7. Fill in App Store Connect credentials and vendor number.
8. Run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and log in with an allowlisted phone number.

## Production at `/dashboard`

Set this before building and running the deployed dashboard:

```bash
NEXT_PUBLIC_DASHBOARD_BASE_PATH=/dashboard
```

With that value, Next serves the app at `/dashboard`, API routes under `/dashboard/api/*`, and the dashboard session cookie is scoped to `/dashboard`. Phone auth is still required: Firebase verifies the client phone sign-in, then the server only creates a session for numbers listed in `DASHBOARD_ALLOWED_PHONE_NUMBERS`.

Before publishing `wayfloat.com/dashboard`, also add `wayfloat.com` to the dashboard Firebase project's Authentication > Settings > Authorized domains. The existing `wayfloat_website` app is an Azure Static Web App and cannot run this Next server by itself, so the production host needs to route `/dashboard/*` to this Next app while leaving the public site routes on the static website.

## Production at `dashboard.wayfloat.com`

This app is deployed to Firebase App Hosting backend `dashboard` in project `app-performance-dashboard`.

```bash
firebase deploy --only apphosting:dashboard --project app-performance-dashboard
```

For the subdomain deployment, leave `NEXT_PUBLIC_DASHBOARD_BASE_PATH` unset/empty. The default Firebase App Hosting URL is:

```text
https://dashboard--app-performance-dashboard.us-central1.hosted.app
```

The custom domain `dashboard.wayfloat.com` is mapped in Firebase App Hosting and uses Azure DNS records in the `wayfloat.com` zone:

```text
dashboard.wayfloat.com A 35.219.200.1
dashboard.wayfloat.com TXT fah-claim=002-02-92808c76-c604-485c-9976-9a091295cd0b
_acme-challenge_37zms4qlx63nraqa.dashboard.wayfloat.com CNAME ed104de1-5f12-4f12-b8b4-3d57e5deda20.2.authorize.certificatemanager.goog.
```

Phone auth authorized domains include both the default App Hosting host and `dashboard.wayfloat.com`.

## Data Model

Metric snapshots are written to the dedicated dashboard Firebase project in per-app collections:

- `puzzleCanvas/dashboard`
- `savoryAdvisor/dashboard`
- `receiptCam/dashboard`

Each app stores durable daily chart history in `dailyMetrics/{yyyy-mm-dd}` and refresh audit records in `refreshRuns/{runId}`. The legacy `metricSnapshots/latest/apps` path is still written as a migration fallback.

The dashboard reads each app's production Firestore project only through the server-side Firebase Admin SDK.
Puzzle Canvas and Savory Advisor product-specific sales cards use comma-separated product id lists from `.env.local`.
