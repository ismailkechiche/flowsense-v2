# FLOWSENSE

Passenger-queue analytics for airport checkpoints (Check-in, Security,
Passport Control, Boarding Gate). Field staff time each **group of 1–6
passengers** (arrival, service start, service end); FLOWSENSE validates the
data and turns it into passenger-weighted KPIs, staffing recommendations and
PDF reports.

> **Build status.** FLOWSENSE was delivered in six phases, all complete.
>
> | Phase | Scope | State |
> |---|---|---|
> | 1 | Config, migrations, auth + approval, cookies + CSRF, RBAC, bootstrap admin, checkpoints | ✅ done |
> | 2 | Sessions, observations, shift detection, row validation | ✅ done |
> | 3 | Excel import (preview, fuzzy mapping, split, commit, rollback) | ✅ done |
> | 4 | Metrics module, dashboard, Erlang C, simulator | ✅ done |
> | 5 | Pivot builder, PDF reports | ✅ done |
> | 6 | Audit log screen, backups, full README | ✅ done |

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

Import history (with rollback), the audit log and backups share one **Admin**
page with a tab each (`#/admin?tab=imports|audit|backups`), shown only to
admins; the old `#/imports`, `#/audit` and `#/backups` links open the
matching tab.

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
| `BACKUP_DIR` | Folder for database backups (created if missing). Relative paths are relative to `backend/`. Put it on a different disk from `DB_PATH` if you can. |
| `BACKUP_INTERVAL_HOURS` | Hours between automatic backups (one is also made at every start). |
| `BACKUP_RETENTION_COUNT` | How many backup files to keep; older ones are deleted after each backup. |
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
| Checkpoint | | Matched to the configured checkpoints, with common French names (*Sûreté*, *PAF*, *Embarquement*…). Most sheets have no such column: pick the checkpoint for the file at the top of the preview, and it applies to every row (it also replaces a guessed checkpoint column). Columns of computed durations (*processing time*, *waiting time*, *total time*) are never mapped automatically. Unknown names get a dropdown in the preview; rows left unmapped are skipped. |
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

**Rollback** (Admins, *Admin → Import history*) deletes exactly what the batch
created: its observations, plus the sessions it created. Sessions it only
added to keep their other rows. If someone added rows by hand to a session
the import created, the rollback lists them and asks again before deleting
them with the session.

**SheetJS.** Files are parsed with SheetJS 0.20.3, installed from the
official `cdn.sheetjs.com` tarball (see `backend/package.json`).
PDF reports use PDFKit from the npm registry. The `xlsx`
package on the npm registry is stuck at 0.18.5, which has known
vulnerabilities, so don't replace the URL with `npm install xlsx`. If your
network blocks `cdn.sheetjs.com`, `npm install` fails on that package: allow
the host or download the tarball and install it from a local path.

## The pax-weighting rule

Every KPI in FLOWSENSE is **passenger-weighted**, never a plain row average.
A row is a *group*, so a family of six that waited 30 minutes must count six
times:

```
pax_weighted_avg(metric) = SUM(metric × pax) / SUM(pax)
```

**Worked example.** Three groups at Security:

| Group | Pax | Wait |
|---|--:|--:|
| Family | 6 | 30 min |
| Solo traveller | 1 | 0 min |
| Solo traveller | 1 | 0 min |

- Row average: (30 + 0 + 0) / 3 = **10 min**. Looks fine against a 10-minute SLA.
- Pax-weighted: (30×6 + 0×1 + 0×1) / 8 = **22.5 min**. Six of the eight
  passengers waited half an hour, which is what the dashboard shows.

The formula is written **once**, in `backend/src/domain/metrics.js`, as a
SQL fragment builder (`paxWeightedAvgSql`) and as a JS function
(`paxWeightedAvg`). The same file holds the pax-weighted percentile, SLA
compliance, breach counts and the rate formulas. **Any new KPI must be
built from these helpers**; tests compare every analytics endpoint against
the JS functions on a fixture where row and pax-weighted averages differ.

## KPI definitions

All times are local airport time; no time-zone conversion happens anywhere.

| KPI | Definition |
|---|---|
| Waiting time (row) | service start − arrival, minutes |
| Processing time (row) | service end − service start, minutes |
| Total time (row) | service end − arrival, minutes |
| Avg wait / processing / total | pax-weighted average of the row values |
| Throughput | SUM(pax) / observed hours. Each session's window is its last service end − its first arrival; over several sessions the windows are **added up**, so nights and gaps between sessions don't count as observed time. |
| SLA compliance % | SUM(pax with wait ≤ SLA) / SUM(pax) × 100 |
| SLA breach | a row whose wait is **above** its checkpoint's `sla_wait_minutes`; counted in passengers and in groups |
| P50 / P90 wait | pax-weighted percentiles, "lower nearest rank": the smallest wait w such that passengers waiting ≤ w are at least 50 % / 90 % of all passengers |
| λ (arrival rate) | SUM(pax) / arrival window in minutes (last arrival − first arrival, added up per session as for throughput) |
| μ (service rate per server) | SUM(pax) / SUM(processing minutes), i.e. passengers one server handles per minute. This equals 1 / pax-weighted average of processing time *per passenger*. |
| c (servers) | distinct counters recorded per session, pax-weighted across sessions and rounded; a session with no counters counts as the checkpoint's configured `servers` |

SLA checks always use each checkpoint's threshold **in force now**: changing
an SLA re-evaluates past data. Historical thresholds are out of scope.

Hourly analysis groups rows by the hour of arrival; its throughput is the
passengers arriving in that hour divided by the number of days that hour was
observed.

## Queueing model (M/M/c)

`backend/src/domain/queueing.js` takes λ and μ (passengers per minute) and c
(servers, a whole number 1–100) and returns:

| Output | Formula |
|---|---|
| ρ (utilisation) | λ / (c·μ) |
| P(wait) | Erlang C(c, a) with a = λ/μ |
| Wq (wait in queue) | P(wait) / (c·μ − λ), minutes |
| Lq (queue length) | λ · Wq |
| W (time in system) | Wq + 1/μ |
| L (passengers in system) | λ · W |

- **ρ ≥ 1 means overloaded**: there is no steady state, so the result is
  `{ overloaded: true }` with every wait and length `null`. The UI shows
  "Overloaded — queue grows without limit".
- Erlang C is computed from the Erlang B recurrence
  `B(k) = a·B(k−1) / (k + a·B(k−1))`, so no factorials are formed and c = 100
  is exact. Unit tests check it against textbook values.
- **Servers needed** is the smallest c whose Wq is within the checkpoint's
  SLA, searched up to 100 ("more than 100" otherwise).

## Dashboard and simulator

**Dashboard** (Analysts and Admins) leads with bar and line charts and keeps
tables only where exact numbers matter. It has four tabs (the browser
remembers the last one):

- **Overview**: headline KPI tiles (avg wait, P90, SLA compliance,
  passengers), key findings written in plain sentences (busiest hour,
  checkpoints above their SLA, short-staffed checkpoints, worst day) and
  average wait by checkpoint against each SLA target;
- **Hours & days**: passengers and wait by hour of day, the daily trend and
  the wait-time histogram (5-minute bins in passengers, SLA as dashed lines);
- **Staffing**: counters open vs needed and utilisation per checkpoint, plus
  a compact staffing table (sorted with overloaded checkpoints first, then by
  how far the predicted wait exceeds the SLA). The full M/M/c columns
  (P(wait), Lq, W, L) are one click away;
- **Flights & counters**: average wait and processing time per flight and
  per counter (the 12 busiest), with the exact numbers folded underneath.

Terms such as λ, μ, ρ, P90 or Wq carry a small ⓘ that explains them in plain
words. The filters are shared by every analytics screen: a period (all
dates, last 7 days, last 30 days or a custom range on the session date,
inclusive), checkpoint chips with an "All checkpoints" chip, and one session
under *More filters*. Changes apply straight away and a line under the
filters says what is shown.

API: `GET /api/analytics/{summary,bottlenecks,hourly,breakdown,distribution,trend}`
with `checkpoint_id` (repeat it or comma-separate it), `from`, `to`,
`session_id`. Collectors get 403 on all of them.

**Simulator** pre-fills arrivals, service rate, counters and the SLA from a
checkpoint's observed data (`GET /api/simulator/defaults?checkpoint_id=…`).
Rates are entered **per hour** (passengers arriving per hour, passengers one
counter serves per hour); the page converts them to the per-minute λ and μ
the API uses. Every change recomputes on the server
(`GET /api/simulator/run?lambda=…&mu=…&c=…&sla_minutes=…`) and shows a
verdict (within / above the SLA, or overloaded), the counters needed, and a
bar chart of the predicted wait for each number of counters (one server run
per bar).

Charts use Chart.js 4.5.1, served from `frontend/vendor/` (MIT licence
alongside) because the Content-Security-Policy only allows scripts from the
site itself.

## Pivot builder and PDF reports

**Pivot & reports** (Analysts and Admins). Pick:

- a **row** dimension and optionally a **column** dimension: checkpoint,
  date, hour, shift, flight, counter;
- one or more **metrics**: avg wait, avg processing, avg total time,
  throughput, SLA compliance %, passengers, groups, breach pax;
- **Table**, **Bar** (the default) or **Line**. Line is only offered when the
  rows have a natural order (date or hour). A chart shows only the chart; a
  table is shown only when **Table** is chosen. With a column dimension and
  several metrics, there is one chart per metric;
- the same filters as the dashboard.

*Quick start* buttons fill the builder with common views (wait by
checkpoint, passengers by hour, wait by hour per checkpoint, daily trend,
flight table).

Every cell is pax-weighted through `domain/metrics.js`. Throughput per cell
adds up each session's own window within that cell, like the dashboard. A
cell's average wait gets a breach badge when it is above the SLA its
passengers are measured against. Results are capped at **1,000 cells**;
beyond that the server answers with a clear error asking you to narrow the
filters. Rows without a flight or counter appear as "(none)".

**Add to report** stores the pivot's *configuration* (dimensions, metrics,
filters, chart type, title) in a report draft, not its numbers. You can
reorder and remove sections. The draft lives in the browser tab
(sessionStorage), so a refresh keeps it.

**Generate PDF** needs a scope: one session, or a date range (optionally a
few checkpoints). The server recomputes everything and streams an A4 PDF,
black and white only, in this order:

1. cover (title, scope, generated by, generated at, contents);
2. **key findings**: a short written summary (volume and average wait, SLA
   breaches, checkpoints above their SLA, busiest and slowest hours, worst
   day, overloaded or short-staffed checkpoints, the flight with the most
   breaches);
3. KPI summary, each indicator with a one-line meaning;
4. **by checkpoint**: avg / P90 wait against the SLA (chart) and a table
   with passengers, waits, processing, throughput, compliance and peak hour;
5. **by hour of day**: passengers and average wait per hour (charts), the
   hourly table, and average wait by hour × checkpoint;
6. **daily trend** (when the scope covers more than one day);
7. **wait time distribution**: histogram, median and P90, the share
   within each SLA, and a table with cumulative shares;
8. **flights and counters**: the 15 busiest flights (chart and table) and
   the counters;
9. **SLA breach details**: by checkpoint, the hours and the flights with the
   most breaches;
10. **staffing recommendations**: the M/M/c table, with counters needed at
    the average and at the busiest hour's arrival rate, and a written
    reasoning per checkpoint (arrivals, service rate, utilisation, predicted
    vs observed wait, recommendation);
11. the pivot sections in your order: a **Table** section shows only the
    table, a **Bar** or **Line** section shows only the chart (drawn with
    PDFKit vector shapes; one chart per metric when split by columns);
12. a glossary; page numbers in the footer.

Long tables continue on the next page with their header repeated. Values
above the SLA are **bold with a `(!)` marker**. Bar series are told apart
by fill pattern and line series by dash style and marker shape. The PDF uses
the standard Helvetica font, so Greek letters are spelled out (lambda, mu,
rho).

The file is named `flowsense-report-{scope}-{YYYYMMDD-HHmm}.pdf`, where scope
is `session-{id}` or `{from}_{to}`. **After the PDF has downloaded, the
builder and the draft reset** to their empty state. If generation fails
(for example no scope chosen) nothing is reset, and the error says what to
fix.

API: `GET /api/pivot/options`, `POST /api/pivot` (a configuration),
`POST /api/reports` (`{ scope, sections, title }`).

## Backups and restore

Backups are made with SQLite's online backup API (better-sqlite3
`db.backup()`), not by copying the file, so they are consistent even while
people are using the app. Each one is a complete, standalone SQLite file
named `flowsense-YYYY-MM-DD-HHmm.db` (server local time) in `BACKUP_DIR`. A
second backup in the same minute gets a `-2` suffix (then `-3`, and so on).

**Manual backup.** As an admin, open **Admin → Backups** and click **Back up now**.
The page lists the existing backups with their size and date.
(API: `POST /api/admin/backups`, `GET /api/admin/backups`.)

**Scheduled backups.** The server makes one backup when it starts, then one
every `BACKUP_INTERVAL_HOURS`. Scheduled backups show as *System* in the
audit log.

**Retention.** After every backup, only the newest `BACKUP_RETENTION_COUNT`
files matching the name pattern above are kept; older ones are deleted and
their names are recorded in the `backup_created` audit entry (`pruned`).
Other files in `BACKUP_DIR` are never touched.

**Failures** (disk full, folder not writable…) are written to the server log
and to the audit log as `backup_failed` with the reason. They never stop the
server; a half-written file is removed.

**Backups cannot be downloaded over HTTP**, on purpose: the database holds
password hashes. To get a copy off the machine, copy files from `BACKUP_DIR`
with your normal server tools.

### Restoring a backup

1. **Stop the server** (Ctrl+C, or stop the service). Restoring while it
   runs will corrupt data.
2. **Move the current database aside**, together with its WAL files.
   SQLite runs in WAL mode, so next to `flowsense.db` there may be
   `flowsense.db-wal` and `flowsense.db-shm`. Move all three; a stale
   `-wal` file left next to the restored database would be replayed into
   it.
   ```sh
   cd backend
   mkdir -p data/replaced
   mv data/flowsense.db data/flowsense.db-wal data/flowsense.db-shm data/replaced/ 2>/dev/null
   ```
3. **Copy the chosen backup to `DB_PATH`:**
   ```sh
   cp backups/flowsense-2026-10-12-0930.db data/flowsense.db
   ```
4. **Restart the server:** `node server.js`.
5. **Verify** by logging in and opening Sessions or the Dashboard. Keep
   `data/replaced/` until you are sure, then delete it.

(The paths above use the defaults from `.env.example`; use your own
`DB_PATH` and `BACKUP_DIR`. Windows: use `move` and `copy`, or File
Explorer, with the server stopped.)

## Audit log

Admins can read the audit log under **Admin → Audit log**: newest first, 50 per
page, filterable by action and by date range (inclusive, server local
date). Each entry shows when, who (*System* for scheduled backups), the
action, the target, and details (for checkpoint changes, the before and
after values of each changed field).

Recorded actions: `user_approved` (also used when a disabled user is
re-enabled), `user_rejected`, `user_role_changed`, `user_disabled`,
`import_committed`, `import_rolled_back`, `session_deleted`,
`checkpoint_created`, `checkpoint_updated`, `backup_created`,
`backup_failed`.

Each entry is written **in the same database transaction** as the action it
records: if one fails, neither is saved. The API has no way to change or
delete entries (`GET /api/audit` and `GET /api/audit/actions` only).

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
  (`script-src 'self'`), so the frontend loads no third-party scripts
  (Chart.js is vendored).
- **Analytics filters** are bound SQL parameters; checkpoint ids, dates and
  session ids are validated before any query runs, and the breakdown
  dimensions come from a fixed server-side list.
- **Why the pivot uses a whitelist.** A pivot lets users choose what to
  GROUP BY and what to compute, which is exactly where SQL injection
  usually creeps in, because column names can't be bound parameters. So
  the browser only sends *keys* (`"hour"`, `"avg_wait"`). The server looks
  each one up in a fixed object (`backend/src/domain/pivotWhitelist.js`)
  that holds the SQL, and answers `400 unknown_pivot_key` to anything else.
  User text never reaches the SQL string. Filter values are bound
  parameters. Tests send injection strings as dimension and metric names
  and check for 400.
- **Backups are not downloadable** over HTTP; the files stay on the server.
- **The audit log is append-only** through the app: there are no update or
  delete routes, and entries are written inside the action's transaction.
- **Errors.** In production, error responses carry a message and a code,
  never a stack trace; details go to the server log.
- **Secrets.** `.env` is in `.gitignore`; only `.env.example` is committed.
- **Reports are recomputed on the server.** The report request carries only
  configurations and a scope; any data the browser might send is rejected,
  and every number in the PDF comes from the database at generation time.

## Known limitations and out of scope

These are deliberately not part of FLOWSENSE v2:

- **Real-time streaming.** Data arrives by manual entry or Excel import;
  dashboards show it when you reload or change a filter.
- **Mobile apps.** The web app works on phones and tablets, but there is no
  native app and no offline mode.
- **Multi-airport tenancy.** One installation serves one airport; there is
  no tenant separation.
- **Historical SLA versioning.** Changing a checkpoint's SLA threshold
  re-evaluates all past data against the new value. The audit log keeps the
  old value for reference.
- **Email notifications.** Nobody is emailed (for example about pending
  sign-ups); admins check the Users page.
- **Downloadable backups over HTTP.** Copy backup files on the server.
- **Single sign-on (SSO).** Accounts are local email and password.

Other limits worth knowing:

- SQLite suits one server process and a modest number of concurrent users;
  run exactly one `node server.js` per database file.
- The M/M/c model assumes random arrivals and exponential service times in
  steady state; treat its numbers as guidance.
- Pivots are capped at 1,000 cells and reports at 20 pivot sections.

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
    jobs/            the backup scheduler
    pdf/             PDF layout, tables and charts
  test/              unit + integration tests
frontend/            static single-page app (ES modules, no build step)
```

Times are stored as local airport time strings (`YYYY-MM-DDTHH:MM:SS`, no
offset); nothing is converted to UTC.
