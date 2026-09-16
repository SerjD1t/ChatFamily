-- Author labels are scoped to the message's conversation, not the viewer's selected family.
CREATE FUNCTION chat_author_label(author text, conversation text) RETURNS text
LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN c.kind='family'
   THEN concat_ws(' · ',COALESCE(NULLIF(u.first_name,''),u.display_name),
     NULLIF(NULLIF(btrim(fm.relationship),''),'Неопределено'))
   ELSE u.display_name END
 FROM users u JOIN conversations c ON c.id=conversation
 LEFT JOIN family_members fm ON fm.user_id=u.id AND fm.family_id=c.family_id
 WHERE u.id=author
$$;
