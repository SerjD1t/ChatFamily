CREATE TABLE mobile_push_devices (
    installation_id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token text NOT NULL UNIQUE,
    updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX mobile_push_devices_user ON mobile_push_devices(user_id);
