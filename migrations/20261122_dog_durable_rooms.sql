-- DOG Phase P3: OPTIONAL Postgres schema; NOT executed in production yet.
-- Apply through a reviewed deployment only AFTER a durable Render Postgres
-- database has been provisioned. This is not the Firestore room collection.
BEGIN;

CREATE TABLE IF NOT EXISTS dog_room_states (
  room_code      VARCHAR(6) PRIMARY KEY,
  match_id       TEXT NOT NULL,
  version        BIGINT NOT NULL CHECK (version >= 1),
  snapshot       JSONB NOT NULL,
  expires_at_ms  BIGINT NOT NULL,
  updated_at_ms  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS dog_room_states_expiration_idx
  ON dog_room_states (expires_at_ms);

CREATE TABLE IF NOT EXISTS dog_room_actions (
  room_code      VARCHAR(6) NOT NULL REFERENCES dog_room_states(room_code) ON DELETE CASCADE,
  match_id       TEXT NOT NULL,
  action_id      VARCHAR(90) NOT NULL,
  actor_uid      TEXT NOT NULL,
  request_hash   CHAR(64) NOT NULL,
  room_version   BIGINT NOT NULL,
  created_at_ms  BIGINT NOT NULL,
  PRIMARY KEY (room_code,match_id,action_id)
);

CREATE TABLE IF NOT EXISTS dog_room_outbox (
  event_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_code      VARCHAR(6) NOT NULL REFERENCES dog_room_states(room_code) ON DELETE CASCADE,
  match_id       TEXT NOT NULL,
  action_id      VARCHAR(90) NOT NULL,
  room_version   BIGINT NOT NULL,
  topic          TEXT NOT NULL CHECK (topic = 'room-changed'),
  created_at_ms  BIGINT NOT NULL,
  delivered_at_ms BIGINT,
  UNIQUE (room_code,match_id,action_id,topic)
);

CREATE INDEX IF NOT EXISTS dog_room_outbox_pending_idx
  ON dog_room_outbox (event_id) WHERE delivered_at_ms IS NULL;

-- Keep the final move and immutable winner snapshot PRIVATE until the
-- Firestore match receipt has credited every human player's XP.
-- The unfinished live room remains untouched and can be safely restored.
CREATE TABLE IF NOT EXISTS dog_room_pending_finishes (
  room_code VARCHAR(6) PRIMARY KEY REFERENCES dog_room_states(room_code) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  action_id VARCHAR(90) NOT NULL,
  actor_uid TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  base_version BIGINT NOT NULL,
  finished_snapshot JSONB NOT NULL,
  finished_at_ms BIGINT NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  created_at_ms BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at_ms BIGINT NOT NULL DEFAULT 0,
  requires_review BOOLEAN NOT NULL DEFAULT FALSE,
  last_error_code TEXT,
  UNIQUE (room_code,match_id,action_id)
);

CREATE INDEX IF NOT EXISTS dog_room_pending_finishes_by_match_idx
  ON dog_room_pending_finishes (match_id);

CREATE INDEX IF NOT EXISTS dog_room_pending_finishes_due_idx
  ON dog_room_pending_finishes (next_attempt_at_ms,created_at_ms)
  WHERE requires_review=FALSE;


-- Seasonal DOG move and final-action payouts must be frozen in PostgreSQL
-- BEFORE attempting their (separately atomic) Firestore wallet/XP settlement.
-- The old room snapshot stays visible, and no outbox event is published,
-- until the payout receipt is acknowledged from Firebase.
CREATE TABLE IF NOT EXISTS dog_room_pending_rewards (
  room_code VARCHAR(6) PRIMARY KEY REFERENCES dog_room_states(room_code) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  action_id VARCHAR(90) NOT NULL,
  actor_uid TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  base_version BIGINT NOT NULL,
  before_snapshot JSONB NOT NULL,
  after_snapshot JSONB NOT NULL,
  vouchers JSONB NOT NULL,
  recorded_at_ms BIGINT NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  is_final BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_ms BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at_ms BIGINT NOT NULL DEFAULT 0,
  requires_review BOOLEAN NOT NULL DEFAULT FALSE,
  last_error_code TEXT,
  UNIQUE (room_code,match_id,action_id)
);

CREATE INDEX IF NOT EXISTS dog_room_pending_rewards_due_idx
 ON dog_room_pending_rewards(next_attempt_at_ms,created_at_ms)
 WHERE requires_review=FALSE;

-- Durable completion proof permits idempotent PostgreSQL ACK replay even
-- after the pending row was deleted in a previous committed transaction.
CREATE TABLE IF NOT EXISTS dog_room_reward_completions (
  room_code VARCHAR(6) NOT NULL REFERENCES dog_room_states(room_code) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  action_id VARCHAR(90) NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  is_final BOOLEAN NOT NULL,
  created_at_ms BIGINT NOT NULL,
  PRIMARY KEY(room_code,match_id,action_id)
);

COMMIT;
