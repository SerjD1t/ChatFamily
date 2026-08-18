CREATE TABLE IF NOT EXISTS application_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO application_settings(key, value)
VALUES ('min_password_length', '12')
ON CONFLICT (key) DO NOTHING;
