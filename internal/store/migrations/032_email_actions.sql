-- Existing accounts retain access; verification is required only by the new
-- registration flow after SMTP is explicitly enabled and tested.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
CREATE TABLE email_actions (
    email text NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('register','reset')),
    token_hash bytea NOT NULL UNIQUE,
    user_id text REFERENCES users(id) ON DELETE CASCADE,
    first_name text NOT NULL DEFAULT '',
    last_name text NOT NULL DEFAULT '',
    invitation_hash bytea,
    session_epoch timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY(email,purpose)
);
CREATE INDEX email_actions_expiry ON email_actions(expires_at);
