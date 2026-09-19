ALTER TABLE user_preferences ADD COLUMN send_shortcut text NOT NULL DEFAULT 'ctrl_enter'
 CHECK (send_shortcut IN ('ctrl_enter','enter'));
