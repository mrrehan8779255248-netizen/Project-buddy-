# ProjectBuddy — Student Project Partner Matching Platform

ProjectBuddy helps students share project ideas safely, find compatible collaborators, and coordinate work after a partnership is accepted.

## Features

- **Protected project ideas:** public project cards omit the detailed blueprint until the creator or an accepted partner is allowed to view it.
- **Student profiles and skill matching:** university, department, skills, bookmarks, and project discovery.
- **Partnership requests and collaboration chat:** owners can accept or decline requests; accepted partners can use the collaboration room.
- **Password recovery by email OTP:** one-time six-digit codes expire after ten minutes and have a limited number of attempts.
- **Account activity history:** security-relevant account actions are recorded without storing passwords, OTPs, IP addresses, request bodies, or chat message content.
- **Private platform-owner report export:** basic account data and audit events can be exported locally as JSON/CSV. There is no admin page, seeded admin user, admin role, or public endpoint that lists every user.

## Project structure

```text
project/
├── config/db.js
├── middleware/auth.js
├── models/                  # User, Project, Request, collaboration and activity models
├── routes/                  # Authentication, users, projects, requests and own activity
├── scripts/
│   ├── export-owner-report.js
│   └── migrate-remove-admin-access.js
├── utils/email.js
├── server.js
├── app.js
├── index.html
└── style.css
```

## Local setup

1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and set a MongoDB Atlas URI and random `JWT_SECRET` with at least 32 characters.
3. Install dependencies and start the app:

```bash
npm install
npm start
```

The default local URL is `http://localhost:5000`. Do not open `index.html` directly; the app uses the API server and MongoDB as the source of truth.

## Production setup (Render)

The current production app is hosted on Render, with MongoDB Atlas as its database. Keep the service's Start Command consistent with the repository layout. Required variables:

- `MONGODB_URI`
- `JWT_SECRET` (at least 32 random characters)
- Optional `JWT_EXPIRE` (defaults to `7d`)
- `CORS_ORIGINS` for any *different* trusted web origins; same-origin traffic is permitted automatically.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` for email password recovery.

For Gmail SMTP, use a Google App Password with two-step verification, not the regular Google account password. Set secrets in Render's Environment settings only; never commit them to GitHub or send them in chat.

## Removing old admin access

The `/api/admin` API, admin UI, fake/demo admin credentials, admin middleware, and admin-only deletion bypass are removed. The app does not seed an administrator account. Existing account and project data should be backed up before running the one-time migration:

```bash
npm run migrate:remove-admin
```

The migration unsets obsolete `role` values from old user documents instead of deleting real accounts. This means old admin accounts, if present, no longer have a special permission level; they are treated like regular user accounts.

## Owner-only data documentation (JSON + CSV)

Use an Atlas database user with read-only access for reporting where possible. Set `MONGODB_URI` in a private local `.env`, then from this project directory run:

```bash
npm install
npm run export:owner-report
```

The command produces `owner-reports/owner-report-<timestamp>.json`, `users-<timestamp>.csv`, and `activity-<timestamp>.csv`. The report includes user basic details, account creation and last-login timestamps, project/request counts, and recent account activity. It excludes password hashes, OTP values/hashes, and session tokens. The report folder is deliberately blocked from web serving. Treat these exports as personal data: keep them private and never commit them.

## Email password recovery

After configuring the SMTP variables on Render, test **Forgot password?** with a real account. Recovery codes are 6 digits, stored only as keyed HMAC-SHA-256 hashes, expire after ten minutes, and are cleared after success or five invalid attempts. If the SMTP environment is not configured, the endpoint clearly reports that recovery email isn't configured yet rather than claiming to have sent an email.

## Account activity

The `activityevents` collection records account registration, successful login, recovery events, profile changes, project and request changes, bookmark/report actions, and collaboration writes. It avoids request body values, chat contents, passwords, OTPs, tokens, and client IP addresses. Old events are intended to expire after one year. Users can view their own history at `GET /api/account/activity`; the owner-wide report is a local CLI export, not a public admin interface.

## Checks

```bash
npm run check
```

Health endpoint: `GET /api/health`. Before production changes, take a MongoDB Atlas backup/snapshot and verify email settings using a controlled test account.
