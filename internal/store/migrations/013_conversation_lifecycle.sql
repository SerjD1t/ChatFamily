ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS conversations_active_by_family ON conversations(family_id, archived_at) WHERE archived_at IS NULL;
