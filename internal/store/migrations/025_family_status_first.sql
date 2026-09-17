-- Preserve previously applied migrations; change only presentation, not profile data.
CREATE OR REPLACE FUNCTION chat_author_label(author text, conversation text) RETURNS text
LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN c.kind='family' THEN
   CASE WHEN NULLIF(NULLIF(btrim(fm.relationship),''),'Неопределено') IS NULL
     THEN COALESCE(NULLIF(btrim(u.first_name),''),u.display_name)
     ELSE btrim(fm.relationship) || ' (' || COALESCE(NULLIF(btrim(u.first_name),''),u.display_name) || ')'
   END
   ELSE u.display_name END
 FROM users u JOIN conversations c ON c.id=conversation
 LEFT JOIN family_members fm ON fm.user_id=u.id AND fm.family_id=c.family_id
 WHERE u.id=author
$$;
