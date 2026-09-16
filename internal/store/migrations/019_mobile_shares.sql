-- Keep acknowledgements even when a message is deleted: retries must not resurrect it.
CREATE TABLE mobile_shares (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id text NOT NULL,
    request_hash text NOT NULL,
    message_id text NOT NULL,
    conversation_id text NOT NULL,
    PRIMARY KEY (user_id, request_id)
);
