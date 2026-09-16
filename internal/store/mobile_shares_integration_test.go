package store

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"familychat/internal/chat"
)

func TestMobileShareIdempotency(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL for isolated PostgreSQL integration tests")
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
	uid := "test_share_" + id()
	actor := chat.User{ID: uid, Email: uid + "@example.test", Name: "Test", Permissions: map[chat.Permission]bool{chat.SendMessages: true, chat.ManageUsers: true}}
	if err = p.AddUser(actor, actor); err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, "DELETE FROM users WHERE id=$1", uid)
	conversation, err := p.DirectConversation(actor, uid)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Pool.Exec(ctx, "DELETE FROM conversations WHERE id=$1", conversation.ID)
	requestID := "same-request"
	var wg sync.WaitGroup
	ids := make(chan string, 4)
	created := make(chan bool, 4)
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m, fresh, e := p.CreateSharedMessage(ctx, actor, requestID, "hash", conversation.ID, "hello", nil)
			ids <- m.ID
			created <- fresh
			errs <- e
		}()
	}
	wg.Wait()
	close(ids)
	close(created)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	first := ""
	for mid := range ids {
		if first == "" {
			first = mid
		}
		if mid != first {
			t.Fatal("duplicate messages")
		}
	}
	count := 0
	for fresh := range created {
		if fresh {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("created %d messages", count)
	}
	if _, _, err = p.CreateSharedMessage(ctx, actor, requestID, "different", conversation.ID, "changed", nil); !errors.Is(err, ErrShareConflict) {
		t.Fatalf("expected conflict: %v", err)
	}
	if _, err = p.Pool.Exec(ctx, "DELETE FROM messages WHERE id=$1", first); err != nil {
		t.Fatal(err)
	}
	m, fresh, err := p.CreateSharedMessage(ctx, actor, requestID, "hash", conversation.ID, "hello", nil)
	if err != nil || fresh || m.ID != first {
		t.Fatal("retry resurrected deleted message")
	}
	actor.Permissions[chat.SendMessages] = false
	if _, _, err = p.CreateSharedMessage(ctx, actor, "denied", "hash", conversation.ID, "hello", nil); !errors.Is(err, chat.ErrForbidden) {
		t.Fatal("permission bypass")
	}
}
