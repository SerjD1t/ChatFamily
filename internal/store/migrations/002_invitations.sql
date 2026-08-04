CREATE TABLE IF NOT EXISTS invitations (
    id text PRIMARY KEY,
    email text NOT NULL,
    token_hash bytea NOT NULL UNIQUE,
    permissions text[] NOT NULL DEFAULT '{}',
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitations_active_by_email ON invitations (email) WHERE accepted_at IS NULL;
