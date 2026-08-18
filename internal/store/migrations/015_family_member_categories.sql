CREATE TABLE IF NOT EXISTS family_member_categories (
  family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('child','parent','grandparent','guardian','relative')),
  PRIMARY KEY (family_id, user_id, category)
);

CREATE INDEX IF NOT EXISTS family_member_categories_by_category
  ON family_member_categories(family_id, category, user_id);
