ALTER TABLE shopping_items
 ADD COLUMN kind text NOT NULL DEFAULT 'purchase' CHECK (kind IN ('purchase','task')),
 ADD COLUMN description text NOT NULL DEFAULT '' CHECK (char_length(description)<=4000),
 ADD COLUMN assignee_id text REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN archived_at timestamptz,
 ADD COLUMN version bigint NOT NULL DEFAULT 1;

CREATE TABLE family_need_activity (
 id bigserial PRIMARY KEY,
 item_id text NOT NULL REFERENCES shopping_items(id) ON DELETE CASCADE,
 actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action text NOT NULL,
 body text NOT NULL DEFAULT '' CHECK (char_length(body)<=4000),
 before_state jsonb,
 after_state jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX family_need_activity_item ON family_need_activity(item_id,id);
