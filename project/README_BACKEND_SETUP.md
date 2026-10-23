# ProjectBuddy production setup

ProjectBuddy serves its static frontend from Express and stores registered accounts, projects, collaboration requests, bookmarks, messages, and account activity in MongoDB Atlas. Browser storage is only a temporary UI cache; it is not the source of truth for accounts or projects.

## Required Render environment variables

- `MONGODB_URI`: Atlas URI pointing at the `projectbuddy` database.
- `JWT_SECRET`: random secret with at least 32 characters.
- `JWT_EXPIRE`: optional, defaults to `7d`.
- `CORS_ORIGINS`: comma-separated exact origins for a separate trusted frontend, if one is used. Same-origin browser requests are permitted automatically.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`: required to send recovery codes. For Gmail SMTP, use a Google App Password, not your normal account password. Keep all values in Render's Environment settings; do not commit secrets.

The application must be HTTPS in production. Never commit `.env`.

## Password recovery

1. Configure the SMTP environment variables on Render.
2. Deploy/restart the service so the values take effect.
3. Test **Forgot password?** with a real account. A six-digit code expires in ten minutes. After five incorrect attempts, that code is invalidated. Reset requests are rate-limited, codes are stored as HMAC-SHA-256 hashes, and successful password changes invalidate the code.

Until SMTP is configured, the recovery endpoint returns a setup error rather than pretending an email was sent.

## Removing the old admin access

The `/api/admin` route group, the Admin interface, built-in demo admin credentials, admin-only middleware, and admin deletion bypass have been removed. No administrator is seeded. The app does not have a public endpoint that returns all user records.

Run `npm run migrate:remove-admin` once against the production database after deploying the change. It removes legacy `role` fields from existing user documents while preserving the accounts and their profile data. Users who had a former admin account can only use it as a normal account, subject to regular account status checks.

## Owner reports (no admin dashboard)

Use a read-only MongoDB database user for report generation where possible. Set `MONGODB_URI` locally in a private `.env` file, then run:

```bash
npm install
npm run export:owner-report
```

The script produces a JSON document plus CSV files in `owner-reports/` with basic account details, project counts, sent-request counts, login timestamps, and recent account activity. It explicitly omits password hashes, OTP hashes, and session tokens. Treat exports as personal data: store them privately and never commit or publicly share the `owner-reports/` folder.

## Account activity collection

`activityevents` stores successful login, registration, password recovery, profile change, project, request, bookmark, report, and collaboration write events. It does not store IP addresses, request bodies, passwords, OTP values, or chat contents. Documents expire after one year. Users can access only their own recent events through `GET /api/account/activity`; platform-wide summaries are generated locally by the owner export script.

## Health and checks

- Health endpoint: `GET /api/health`
- Current user: `GET /api/auth/me`
- Run syntax checks: `npm run check`

Use backups before operational migrations. The role cleanup removes only the legacy `role` field; it does not delete accounts, projects, requests or messages.
