ALTER TABLE shopping_items ALTER COLUMN family_id DROP NOT NULL;
ALTER TABLE shopping_items ADD COLUMN owner_user_id text REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE shopping_items ADD CONSTRAINT shopping_owner_scope CHECK ((family_id IS NULL) <> (owner_user_id IS NULL));
ALTER TABLE shopping_items ADD CONSTRAINT personal_need_no_assignee CHECK (owner_user_id IS NULL OR assignee_id IS NULL);
CREATE INDEX shopping_personal_owner ON shopping_items(owner_user_id) WHERE owner_user_id IS NOT NULL;
