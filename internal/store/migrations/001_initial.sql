CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    permissions text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
    id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('family', 'group', 'direct')),
    title text,
    direct_key text UNIQUE,
    created_by text REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_manage_members boolean NOT NULL DEFAULT false,
    last_read_at timestamptz,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id text PRIMARY KEY,
    conversation_id text NOT NULL REFERENCES conversations(id),
    author_id text NOT NULL REFERENCES users(id),
    body text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz,
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS messages_by_conversation_and_time ON messages (conversation_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS attachments (
    id text PRIMARY KEY,
    message_id text REFERENCES messages(id) ON DELETE SET NULL,
    object_key text NOT NULL UNIQUE,
    filename text NOT NULL,
    content_type text NOT NULL,
    bytes bigint NOT NULL CHECK (bytes > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
