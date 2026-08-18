ALTER TABLE families ADD COLUMN IF NOT EXISTS parent_family_id text REFERENCES families(id);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS family_role text NOT NULL DEFAULT 'member' CHECK (family_role IN ('admin','member'));
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS relationship text NOT NULL DEFAULT 'Неопределено';
CREATE INDEX IF NOT EXISTS families_by_parent ON families(parent_family_id);
