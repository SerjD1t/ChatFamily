CREATE TABLE IF NOT EXISTS conversation_favorites (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, conversation_id)
);
