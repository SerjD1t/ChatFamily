INSERT INTO conversation_members(conversation_id,user_id)
SELECT c.id, u.id
FROM conversations c
JOIN users u ON u.id IN (split_part(c.direct_key, ':', 1), split_part(c.direct_key, ':', 2))
WHERE c.kind='direct' AND c.direct_key IS NOT NULL
ON CONFLICT DO NOTHING;
