ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_content_type text;
