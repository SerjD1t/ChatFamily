ALTER TABLE shopping_items
  ADD COLUMN IF NOT EXISTS planned_date date;

CREATE INDEX IF NOT EXISTS shopping_items_family_planned
  ON shopping_items(family_id, planned_date, completed_at);
