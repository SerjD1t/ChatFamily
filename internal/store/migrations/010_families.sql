-- A user account is global: this preserves direct messages between all users.
-- Family chats, groups, invitations and family administration are tenant-scoped.
CREATE TABLE IF NOT EXISTS families (
    id text PRIMARY KEY,
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
    created_by text REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);
CREATE TABLE IF NOT EXISTS family_members (
    family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (family_id, user_id)
);
-- The existing installation becomes one family without any manual data move.
INSERT INTO families(id, title, created_by)
SELECT 'default', 'Семья', (SELECT id FROM users ORDER BY created_at, id LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM families WHERE id='default');
INSERT INTO family_members(family_id, user_id, role)
SELECT 'default', id,
       CASE WHEN permissions @> ARRAY['manage_users']::text[] OR permissions @> ARRAY['manage_application']::text[] THEN 'owner' ELSE 'member' END
FROM users ON CONFLICT (family_id, user_id) DO NOTHING;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS family_id text REFERENCES families(id);
UPDATE conversations SET family_id='default' WHERE kind IN ('family','group') AND family_id IS NULL;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_family_scope;
ALTER TABLE conversations ADD CONSTRAINT conversations_family_scope CHECK (
    (kind='direct' AND family_id IS NULL) OR (kind IN ('family','group') AND family_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS conversations_by_family ON conversations(family_id) WHERE family_id IS NOT NULL;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS family_id text REFERENCES families(id);
UPDATE invitations SET family_id='default' WHERE family_id IS NULL;
ALTER TABLE invitations ALTER COLUMN family_id SET NOT NULL;
-- Rename the old global administrator permission while keeping the role data intact.
UPDATE users SET permissions = array_replace(permissions, 'manage_users', 'manage_application')
WHERE permissions @> ARRAY['manage_users']::text[];
