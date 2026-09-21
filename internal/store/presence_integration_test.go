package store

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestPresenceActivity(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := context.Background()
	p, err := Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err = p.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	const uid = "presence-synthetic"
	_, err = p.Pool.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash) VALUES($1,'presence@example.test','Synthetic','unused')`, uid)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, uid)
	read := func() Presence {
		t.Helper()
		values, e := p.UserPresence(ctx, []string{uid})
		if e != nil {
			t.Fatal(e)
		}
		return values[uid]
	}
	if v := read(); v.Online || v.LastActiveAt != nil {
		t.Fatal("new user online")
	}
	if err = p.RecordActivity(ctx, uid, 0); err != nil {
		t.Fatal(err)
	}
	first := read()
	if !first.Online || first.LastActiveAt == nil {
		t.Fatal("activity not recorded")
	}
	if err = p.RecordActivity(ctx, uid, 0); err != nil {
		t.Fatal(err)
	}
	if !read().LastActiveAt.Equal(*first.LastActiveAt) {
		t.Fatal("duplicate write not throttled")
	}
	if _, err = p.Pool.Exec(ctx, `UPDATE users SET last_active_at=now()-interval '181 seconds' WHERE id=$1`, uid); err != nil {
		t.Fatal(err)
	}
	expired := read()
	if expired.Online || expired.LastActiveAt == nil {
		t.Fatal("TTL failed")
	}
	if err = p.RecordActivity(ctx, uid, 25000); err != nil {
		t.Fatal(err)
	}
	if v := read(); !v.Online || time.Since(*v.LastActiveAt) > time.Minute {
		t.Fatal("renewal failed")
	}
	if _, err = p.UserPresence(ctx, make([]string, 101)); err == nil {
		t.Fatal("unbounded batch")
	}
	if _, err = p.Pool.Exec(ctx, `UPDATE users SET disabled_at=now() WHERE id=$1`, uid); err != nil {
		t.Fatal(err)
	}
	values, err := p.UserPresence(ctx, []string{uid})
	if err != nil || len(values) != 0 {
		t.Fatal("disabled user disclosed")
	}
}
