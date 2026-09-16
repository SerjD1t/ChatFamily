ALTER TABLE users ADD COLUMN disabled_at timestamptz;
ALTER TABLE users ADD COLUMN sessions_revoked_at timestamptz NOT NULL DEFAULT 'epoch';
