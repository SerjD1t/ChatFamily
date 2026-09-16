ALTER TABLE users ADD COLUMN first_name text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN last_name text NOT NULL DEFAULT '';
UPDATE users SET first_name=display_name;
ALTER TABLE users ADD CONSTRAINT user_last_name_length CHECK(char_length(last_name)<=120);
