-- A family relationship is scoped to membership, not to a global account.
ALTER TABLE family_members
    ADD COLUMN IF NOT EXISTS relationship text NOT NULL DEFAULT 'Неопределено';
UPDATE family_members
SET relationship='Неопределено'
WHERE btrim(relationship)='';
