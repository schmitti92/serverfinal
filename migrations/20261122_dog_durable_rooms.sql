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

COMMIT;
