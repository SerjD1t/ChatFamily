CREATE TABLE user_automations (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 daily_report_enabled boolean NOT NULL DEFAULT false,
 report_time text NOT NULL DEFAULT '09:00' CHECK (report_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 time_zone text NOT NULL DEFAULT 'Europe/Moscow',
 next_run_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_automations_due ON user_automations(next_run_at) WHERE daily_report_enabled;
CREATE TABLE daily_report_runs (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 report_date date NOT NULL,
 message_id text NOT NULL REFERENCES messages(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,report_date)
);
