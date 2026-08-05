CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_by_user ON push_subscriptions(user_id);
