CREATE TABLE IF NOT EXISTS message_receipts (
    message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivered_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_receipts_user_idx ON message_receipts(user_id, message_id);
-- Preserve historical receipts recorded by the previous client.
INSERT INTO message_receipts(message_id,user_id,delivered_at,read_at)
SELECT m.id,cm.user_id,GREATEST(cm.last_delivered_at,cm.last_read_at),
       CASE WHEN cm.last_read_at>=m.created_at THEN cm.last_read_at END
FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id
WHERE m.author_id<>cm.user_id
AND (cm.last_delivered_at>=m.created_at OR cm.last_read_at>=m.created_at)
ON CONFLICT DO NOTHING;
