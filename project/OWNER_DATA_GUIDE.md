# Platform owner data guide

ProjectBuddy deliberately has no Admin page and no API that returns every account. Use MongoDB Atlas for interactive inspection, or generate a private, documented JSON/CSV snapshot from the owner machine.

## Option A — browse MongoDB Atlas

1. Open MongoDB Atlas and select the `ProjectBuddy` cluster.
2. Choose **Browse Collections** and select the `projectbuddy` database.
3. Open `users` for the basic account profile, `projects` for project metadata, `requests` for partnership activity, `collaborationmessages` for messages, and `activityevents` for the audit trail.
4. Never expose Atlas connection strings or database credentials. For reports, prefer a database user with read-only access.

## Option B — export a report in JSON and CSV

On a trusted computer, in this project folder:

1. Create a private `.env` from `.env.example` and set `MONGODB_URI` to the production database.
2. Install dependencies with `npm install`.
3. Run `npm run export:owner-report`.

The command writes three files under `owner-reports/`:

- `owner-report-<timestamp>.json`: combined summary, users, counts, and recent account events.
- `users-<timestamp>.csv`: basic user details, creation/login timestamps, and project/request counts.
- `activity-<timestamp>.csv`: recent recorded events with a timestamp, user ID, event key, and short summary.

The user report includes profile name/email, university, department, year, skills, account status/reference, account creation time, last login, project count, sent proposal count, and up to ten recent activity items per user. Activity files are capped at the latest 20,000 events, and the combined JSON reports the total number of accounts/projects/requests.

Reports exclude passwords, password hashes, recovery codes, OTP hashes, JWTs, and chat content. Keep the output private, delete it when no longer needed, and do not upload it to GitHub or place it in the website's public directory. The app blocks web access to `owner-reports/`.

## Activity retention and privacy

Account event records are intended to expire after one year. They record registration, successful logins, password recovery, project/request changes, bookmark/report actions, and collaboration writes. The app does not intentionally put passwords, OTP values, session tokens, IP addresses, request bodies, or chat message bodies into these events.


## Important note about records created before the database-backed update

Older versions of the site kept some records in each visitor's browser storage rather than MongoDB. Those browser-local records are not present in Atlas and cannot be reconstructed from the server. This update preserves the old browser storage keys as a local backup, but does not automatically upload them. The owner should back up any valuable browser-only records before replacing the live bundle; each existing user may need to create an account in the database-backed version unless a deliberate, user-approved migration is built for their local data.
