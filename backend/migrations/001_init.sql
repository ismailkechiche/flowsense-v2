-- FLOWSENSE initial schema.
-- All timestamps are local airport time stored as 'YYYY-MM-DDTHH:MM:SS' (no offset).

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  email         TEXT    NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('collector', 'analyst', 'admin')),
  status        TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'disabled')),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')),
  approved_by   INTEGER REFERENCES users (id),
  approved_at   TEXT
);

CREATE TABLE checkpoints (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(name)) > 0),
  area             TEXT,
  servers          INTEGER NOT NULL DEFAULT 1 CHECK (servers >= 1),
  sla_wait_minutes REAL    NOT NULL CHECK (sla_wait_minutes > 0),
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))
);

CREATE TABLE import_batches (
  id                 INTEGER PRIMARY KEY,
  filename           TEXT    NOT NULL,
  file_sha256        TEXT    NOT NULL,
  uploaded_by        INTEGER NOT NULL REFERENCES users (id),
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')),
  status             TEXT    NOT NULL DEFAULT 'committed' CHECK (status IN ('committed', 'rolled_back')),
  column_mapping     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(column_mapping)),
  split_summary      TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(split_summary)),
  session_ids        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(session_ids)),
  row_count          INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  rejected_row_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_row_count >= 0),
  rolled_back_by     INTEGER REFERENCES users (id),
  rolled_back_at     TEXT
);
CREATE INDEX idx_import_batches_sha ON import_batches (file_sha256, status);

CREATE TABLE sessions (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  date            TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  shift           TEXT    CHECK (shift IN ('morning', 'afternoon', 'night')),
  checkpoint_id   INTEGER NOT NULL REFERENCES checkpoints (id),
  observer        TEXT,
  notes           TEXT,
  import_batch_id INTEGER REFERENCES import_batches (id),
  created_by      INTEGER NOT NULL REFERENCES users (id),
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))
);
CREATE INDEX idx_sessions_date ON sessions (date);
CREATE INDEX idx_sessions_checkpoint_date ON sessions (checkpoint_id, date);
CREATE INDEX idx_sessions_import_batch ON sessions (import_batch_id);

CREATE TABLE observations (
  id                   INTEGER PRIMARY KEY,
  session_id           INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  -- Set when the row came from an import; NULL for rows entered by hand.
  -- Lets an import rollback list observations appended manually afterwards.
  import_batch_id      INTEGER REFERENCES import_batches (id),
  passenger_group_code TEXT    NOT NULL,
  pax                  INTEGER NOT NULL CHECK (pax BETWEEN 1 AND 6),
  flight_no            TEXT,
  counter              TEXT,
  arrival_time         TEXT    NOT NULL,
  service_start        TEXT    NOT NULL,
  service_end          TEXT    NOT NULL,
  wait_minutes         REAL    NOT NULL CHECK (wait_minutes >= 0),
  processing_minutes   REAL    NOT NULL CHECK (processing_minutes >= 0),
  total_minutes        REAL    NOT NULL CHECK (total_minutes >= 0),
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))
);
CREATE INDEX idx_observations_session ON observations (session_id);
CREATE INDEX idx_observations_arrival ON observations (arrival_time);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY,
  -- NULL only for system actions (e.g. the scheduled backup).
  actor_user_id INTEGER REFERENCES users (id),
  action        TEXT    NOT NULL,
  target_type   TEXT,
  target_id     INTEGER,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')),
  details       TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(details))
);
CREATE INDEX idx_audit_action_created ON audit_log (action, created_at);
CREATE INDEX idx_audit_created ON audit_log (created_at);
