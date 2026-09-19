ALTER TABLE conversations ADD COLUMN group_owner_id text REFERENCES users(id);
ALTER TABLE conversations ADD COLUMN icon text NOT NULL DEFAULT '';
ALTER TABLE conversation_members ADD COLUMN group_admin boolean NOT NULL DEFAULT false;
ALTER TABLE conversation_members ADD COLUMN can_invite boolean NOT NULL DEFAULT false;
ALTER TABLE conversations DROP CONSTRAINT conversations_family_scope;
UPDATE conversations SET group_owner_id=created_by,family_id=NULL WHERE kind='group';
-- Do not grant access to a former creator who is no longer a member. Missing or
-- unavailable owners are repaired explicitly through application administration.
ALTER TABLE conversations ADD CONSTRAINT conversations_family_scope CHECK (
 (kind='family' AND family_id IS NOT NULL AND group_owner_id IS NULL) OR
 (kind='direct' AND family_id IS NULL AND group_owner_id IS NULL) OR
 (kind='group' AND family_id IS NULL)
);
CREATE INDEX conversations_group_owner ON conversations(group_owner_id) WHERE kind='group';
