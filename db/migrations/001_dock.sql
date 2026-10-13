CREATE TABLE IF NOT EXISTS dock_settings (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS dock_sessions (token_hash text PRIMARY KEY, expires_at bigint NOT NULL, data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS dock_sessions_expiry ON dock_sessions (expires_at);
CREATE TABLE IF NOT EXISTS dock_runs (id uuid PRIMARY KEY, data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS dock_runs_created ON dock_runs (((data->>'created_at')::bigint) DESC);
CREATE INDEX IF NOT EXISTS dock_runs_participant ON dock_runs ((data->>'participant_id'));
CREATE TABLE IF NOT EXISTS dock_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at bigint NOT NULL);
