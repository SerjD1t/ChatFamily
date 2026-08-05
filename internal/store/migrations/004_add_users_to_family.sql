INSERT INTO conversation_members(conversation_id,user_id)
SELECT 'family', u.id
FROM users u
WHERE EXISTS (SELECT 1 FROM conversations WHERE id = 'family')
ON CONFLICT DO NOTHING;
