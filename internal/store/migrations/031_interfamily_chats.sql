ALTER TABLE conversations DROP CONSTRAINT conversations_kind_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_kind_check CHECK(kind IN ('family','group','direct','interfamily'));
ALTER TABLE conversations DROP CONSTRAINT conversations_family_scope;
ALTER TABLE conversations ADD CONSTRAINT conversations_family_scope CHECK(
 (kind='family' AND family_id IS NOT NULL AND group_owner_id IS NULL) OR
 (kind IN ('direct','interfamily') AND family_id IS NULL AND group_owner_id IS NULL) OR
 (kind='group' AND family_id IS NULL));
CREATE TABLE interfamily_chats (
 conversation_id text PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
 origin_family_id text NOT NULL REFERENCES families(id),
 target_family_id text REFERENCES families(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','requested','active','closed')),
 token_hash text UNIQUE,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 request_key text NOT NULL UNIQUE,
 version bigint NOT NULL DEFAULT 1,
 CHECK(target_family_id IS NULL OR target_family_id<>origin_family_id)
);
CREATE TABLE interfamily_representatives (
 conversation_id text NOT NULL REFERENCES interfamily_chats(conversation_id) ON DELETE CASCADE,
 family_id text NOT NULL,
 user_id text NOT NULL,
 PRIMARY KEY(conversation_id,family_id,user_id),
 FOREIGN KEY(family_id,user_id) REFERENCES family_members(family_id,user_id) ON DELETE CASCADE
);
CREATE FUNCTION sync_interfamily_representative() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO conversation_members(conversation_id,user_id)
  SELECT NEW.conversation_id,NEW.user_id FROM interfamily_chats WHERE conversation_id=NEW.conversation_id AND state='active'
  ON CONFLICT DO NOTHING;
 ELSE
  UPDATE interfamily_chats SET version=version+1 WHERE conversation_id=OLD.conversation_id;
  DELETE FROM conversation_members cm WHERE cm.conversation_id=OLD.conversation_id AND cm.user_id=OLD.user_id
  AND NOT EXISTS(SELECT 1 FROM interfamily_representatives r WHERE r.conversation_id=OLD.conversation_id AND r.user_id=OLD.user_id);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER interfamily_representative_sync AFTER INSERT OR DELETE ON interfamily_representatives FOR EACH ROW EXECUTE FUNCTION sync_interfamily_representative();
CREATE FUNCTION close_archived_family_chats() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
  UPDATE conversations SET archived_at=now() WHERE id IN (SELECT conversation_id FROM interfamily_chats WHERE origin_family_id=NEW.id OR target_family_id=NEW.id);
  UPDATE interfamily_chats SET state='closed',token_hash=NULL,version=version+1 WHERE origin_family_id=NEW.id OR target_family_id=NEW.id;
  DELETE FROM conversation_members WHERE conversation_id IN (SELECT conversation_id FROM interfamily_chats WHERE origin_family_id=NEW.id OR target_family_id=NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER interfamily_family_archive AFTER UPDATE OF archived_at ON families FOR EACH ROW EXECUTE FUNCTION close_archived_family_chats();
