CREATE TABLE message_forwards (
 user_id text NOT NULL REFERENCES users(id),
 request_id text NOT NULL,
 source_id text NOT NULL,
 conversation_id text NOT NULL REFERENCES conversations(id),
 message_id text NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,request_id)
);
