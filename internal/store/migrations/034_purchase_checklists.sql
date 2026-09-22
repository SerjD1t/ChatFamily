ALTER TABLE shopping_items ADD COLUMN checklist jsonb NOT NULL DEFAULT '[]'::jsonb
 CHECK (jsonb_typeof(checklist) = 'array' AND jsonb_array_length(checklist) <= 100);
