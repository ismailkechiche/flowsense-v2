# FLOWSENSE

Passenger-queue analytics for airport checkpoints (Check-in, Security,
Passport Control, Boarding Gate). Field staff time each **group of 1–6
passengers** (arrival, service start, service end); FLOWSENSE validates the
data and turns it into passenger-weighted KPIs, staffing recommendations and
PDF reports.

> **Build status.** FLOWSENSE is delivered in six phases. This README covers
> what exists today and grows with each phase.
>
> | Phase | Scope | State |
> |---|---|---|
> | 1 | Config, migrations, auth + approval, cookies + CSRF, RBAC, bootstrap admin, checkpoints | ✅ done |
> | 2 | Sessions, observations, shift detection, row validation | ✅ done |
> | 3 | Excel import (preview, fuzzy mapping, split, commit, rollback) | ✅ done |
> | 4 | Metrics module, dashboard, Erlang C, simulator | next |
> | 5 | Pivot builder, PDF reports | |
> | 6 | Audit log screen, backups, full README | |

## Roles

| Capability | Collector | Analyst | Admin |
|---|:-:|:-:|:-:|
| Sessions: create / edit own / list | ✅ | read-only | ✅ |
| Observations: manual entry | ✅ | — | ✅ |
| Excel import (preview + commit) | ✅ | — | ✅ |
| Dashboard, analytics, pivot builder, M/M/c simulator | ❌ (403) | ✅ | ✅ |
| PDF reports | — | ✅ | ✅ |
| Delete sessions | — | — | ✅ |
| Import rollback | — | — | ✅ |
| User management / approvals | — | — | ✅ |
| Checkpoint & SLA config | — | — | ✅ |
| Backups | — | — | ✅ |
| Audit log (read) | — | — | ✅ |

Every role can read the checkpoint list (needed for session forms and filters).

## Requirements: Node.js 22 LTS

FLOWSENSE needs **Node.js 22 LTS** (`"engines": ">=22 <23"`).

- **Do not use Node 25** (or other non-LTS releases): `better-sqlite3` v11
  has no prebuilt binaries for it, so `npm install` tries to compile from
  source and usually fails.
- Node 20 reached end-of-life in April 2026, so the project targets 22.

With [nvm](https://github.com/nvm-sh/nvm) (or nvm-windows / fnm), run this in
the repository root; it reads `.nvmrc`:

```sh
nvm install
nvm use
node -v   # v22.x
```

## Setup

```sh
cd backend
npm install
cp .env.example .env
```

Then edit `backend/.env`:

| Variable | Meaning |
|---|---|
| `PORT` | Port to listen on (default 3001). |
| `JWT_SECRET` | Secret that signs login tokens. **At least 32 characters**; the server refuses to start with a shorter one or with the placeholder. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. |
| `JWT_EXPIRES_IN` | How long a login lasts, e.g. `8h`, `30m`, `1d`. Also the cookie lifetime. |
| `DB_PATH` | SQLite file. Relative paths are relative to `backend/`. Created on first start. |
| `BACKUP_DIR` | Where database backups go. |
| `BACKUP_INTERVAL_HOURS` | Hours between automatic backups. |
| `BACKUP_RETENTION_COUNT` | Number of backup files kept. |
| `COOKIE_SECURE` | `true` when the site is served over HTTPS (adds `Secure` to cookies). Keep `false` for plain `http://localhost`. |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | See below. |

The server checks all of these at startup and lists every missing or invalid
value before exiting.

### The first admin

New accounts start as *pending* and need an admin's approval, so on start-up
the server checks whether an approved admin exists. If none does, it creates
one from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` and logs a
warning. **Log in with those credentials and change the password straight
away** (Account → Change password). Once an approved admin exists, the
bootstrap values are ignored.

## Run

```sh
cd backend
node server.js      # or: npm start
```

Open **http://localhost:3001** (or your `PORT`).

Always use the server URL. Opening `frontend/index.html` directly as a
`file://` page does not work: login relies on cookies that the browser only
sends to the server that set them.

## Tests

```sh
cd backend
npm test
```

Uses `node:test` and `supertest` against an in-memory database. CI runs the
same command on every push and pull request (`.github/workflows/test.yml`).

## Sessions and observations

A **session** is one observation run at one checkpoint on one date. Each
**observation** is one group of 1–6 passengers served together, with three
timestamps: arrival, service start, service end. Wait, processing and total
minutes are computed once when the row is saved and stored with it.

**Row rules** (manual entry and import). A row is rejected, with the reason
shown, when:

- pax is not a whole number from 1 to 6;
- a timestamp is missing or not a real date/time;
- service start is before arrival, or service end is before service start;
- total time is over 6 hours (almost always a typing mistake);
- the arrival date is neither the session date nor the next day (overnight
  sessions may run past midnight).

**Midnight crossing.** On the manual entry form you pick the arrival date
and type three times. A time earlier than the one before it is taken as the
next day (23:58 → 23:59 → 00:03 is a 5-minute row), unless that would make a
gap of more than 6 hours, in which case it is treated as a mistake.

**Shift** is detected automatically from the *pax-weighted* average arrival
time of the session's rows: morning 05:00–12:59, afternoon 13:00–20:59,
night 21:00–04:59. The boundaries live in one constant,
`SHIFT_BOUNDARIES` in `backend/src/domain/shifts.js`. The average is taken
over full timestamps, so a night session from 23:00 to 01:00 is detected as
night, not midday.

**Who can change what.** Collectors edit only sessions they created (and
their observations); admins edit any session and are the only ones who can
delete a session. Analysts can read everything but change nothing.

Lists are paginated: `?page=1&page_size=25` (max 100), returning
`{ items, page, page_size, total, total_pages }`. Sessions can be filtered by
`checkpoint_id`, `from`, `to` (dates, inclusive) and `shift`, newest first.

## Excel import

**Import** (Collectors and Admins) takes an `.xlsx`, `.xls` or `.csv` file
of up to 10 MB. Uploading only builds a **preview**: nothing is saved until
you press *Import N rows into M session(s)*.

**Expected sheet.** One row per passenger group, one header row. Column
names don't need to be exact: they are matched ignoring case, accents and
punctuation, against English and French synonyms (e.g. *Arrivée*, *Heure de
prise en charge*, *Nb pax*), then by similarity (Jaro-Winkler ≥ 0.8). The
preview shows each match with its confidence and lets you change any column.

| Field | Required | Notes |
|---|:-:|---|
| Pax | ✅ | Whole number 1–6. |
| Arrival time, Service start, Service end | ✅ | A time (`14:05`, `14h05`, an Excel time) or a full date and time. |
| Date | | `DD/MM/YYYY` (also `.` or `-`), ISO `YYYY-MM-DD`, or an Excel date. Without a date column, the date is taken from the arrival cell. |
| Checkpoint | | Matched to the configured checkpoints, with common French names (*Sûreté*, *PAF*, *Embarquement*…). Without the column, you pick one checkpoint for the whole file. Unknown names get a dropdown in the preview; rows left unmapped are skipped. |
| Group code, Flight, Counter / lane, Observer | | Optional. Missing group codes become `G001`, `G002`, … per session. |

If the workbook has several sheets, the first one with a header row is
proposed and the preview has a sheet picker. The header row is the first
row with at least three filled cells, so title rows above it are fine.
Empty rows are ignored.

**Midnight crossing.** When a cell holds only a time and it is earlier than
the previous time on the same row, it is taken as the next day (arrival
23:58, service start 00:03 is a 5-minute wait). The preview says how many
rows this affected. Rows still go through every rule in *Sessions and
observations*; failed rows are listed with their sheet row number and reason
and are skipped.

**Split into sessions.** Rows are grouped by **date and checkpoint
together**, so one file with Security and Passport Control on the same day
gives two sessions. Each group defaults to *Create new session* with an
editable name. You may instead add a group to an existing session with the
same checkpoint and date that you are allowed to edit, but this is never
pre-selected: nothing from a previous import is remembered.

**Commit** sends only the preview id and your choices; the server rebuilds
the rows from the file it kept and writes the batch, sessions, observations
and audit entry in **one transaction**, so a failure leaves nothing behind.
Previews live in server memory for 30 minutes (5 per user); after a restart
or expiry, upload the file again.

**Duplicates.** Each file's SHA-256 is stored. Uploading a file that was
already imported shows who imported it and when, and importing it again
requires ticking *Import it again anyway*.

**Rollback** (Admins, *Import history*) deletes exactly what the batch
created: its observations, plus the sessions it created. Sessions it only
added to keep their other rows. If someone added rows by hand to a session
the import created, the rollback lists them and asks again before deleting
them with the session.

**SheetJS.** Files are parsed with SheetJS 0.20.3, installed from the
official `cdn.sheetjs.com` tarball (see `backend/package.json`). The `xlsx`
package on the npm registry is stuck at 0.18.5, which has known
vulnerabilities, so don't replace the URL with `npm install xlsx`. If your
network blocks `cdn.sheetjs.com`, `npm install` fails on that package: allow
the host or download the tarball and install it from a local path.

## Security notes

- **Login cookie.** The JWT lives in an `httpOnly`, `SameSite=Strict` cookie
  (plus `Secure` when `COOKIE_SECURE=true`), never in `localStorage`, so page
  scripts cannot read it. Logout clears it server-side.
- **Access is re-checked on every request.** The server reloads the user from
  the database for each API call, so disabling or re-roling someone takes
  effect on their next click, not when their token expires.
- **CSRF.** On top of SameSite, every POST/PUT/PATCH/DELETE must send an
  `X-CSRF-Token` header equal to the `fs_csrf` cookie (double-submit
  pattern). Another site can make the browser send cookies but cannot read
  them to forge the header.
- **Default-deny routing.** Every API route must declare its access
  (`requireRole(...)` or `publicRoute`). A test walks the router and fails
  for any route without one, and an RBAC matrix test calls every route as
  anonymous, collector, analyst and admin and checks for 401/403.
  Unauthenticated → 401; wrong role → 403.
- **Frontend role gating uses a class toggle.** Elements carry
  `data-roles="analyst admin"` and are shown when JS adds `role-visible`.
  The stylesheet hides `[data-roles]:not(.role-visible)` *without*
  `!important`: an earlier version used `display: none !important`, which
  overrode the script and kept elements hidden for users who should see them.
  The UI gating is cosmetic; the backend 403 is the real protection.
- **Passwords** are hashed with bcrypt (cost 12) and must be at least 10
  characters. Login and signup are rate-limited.
- **Uploads** are capped at 10 MB, parsed in memory, never written to disk,
  and the parser never evaluates formulas. The commit can't inject rows: the
  browser sends only the preview id and choices.
- **Headers.** Helmet sets a strict Content-Security-Policy
  (`script-src 'self'`), so the frontend loads no third-party scripts.

## Project layout

```
backend/
  server.js          start-up: config → migrations → bootstrap admin → listen
  migrations/        numbered SQL files, tracked in schema_migrations
  src/
    config.js        .env validation (fail fast)
    db.js            SQLite (WAL, foreign keys) + migration runner
    app.js           Express app (used by server.js and tests)
    middleware/      auth, rbac, csrf, validate, errors, logging, rate limits
    routes/          HTTP only: validate, call a service, respond
    services/        business rules and transactions (audit writes included)
    repositories/    SQL only
    domain/          pure functions and constants
  test/              unit + integration tests
frontend/            static single-page app (ES modules, no build step)
```

Times are stored as local airport time strings (`YYYY-MM-DDTHH:MM:SS`, no
offset); nothing is converted to UTC.
