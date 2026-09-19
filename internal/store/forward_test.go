package store

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"familychat/internal/chat"
)

func TestForwardIsolationRetryAndIndependentAttachments(t *testing.T) {
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
	var users []chat.User
	defer func() {
		var ids []string
		for _, u := range users {
			ids = append(ids, u.ID)
		}
		p.Pool.Exec(ctx, `DELETE FROM messages WHERE author_id=ANY($1::text[])`, ids)
		p.Pool.Exec(ctx, `DELETE FROM conversations WHERE created_by=ANY($1::text[])`, ids)
		p.Pool.Exec(ctx, `DELETE FROM users WHERE id=ANY($1::text[])`, ids)
	}()
	for _, name := range []string{"forward-a", "forward-b", "forward-c"} {
		u, e := p.Register(name+"@example.test", name, "Synthetic-password-2026", 12)
		if e != nil {
			t.Fatal(e)
		}
		users = append(users, u)
	}
	a, b, c := users[0], users[1], users[2]
	source, e := p.DirectConversation(a, b.ID)
	if e != nil {
		t.Fatal(e)
	}
	dest, e := p.DirectConversation(a, c.ID)
	if e != nil {
		t.Fatal(e)
	}
	original, e := p.CreateMessage(b, source.ID, "Original", []chat.Attachment{{ID: id(), Filename: "synthetic.txt", ContentType: "text/plain", Bytes: 4}})
	if e != nil {
		t.Fatal(e)
	}
	copies := 0
	copier := func(key string, file chat.Attachment) (chat.Attachment, error) {
		copies++
		file.ID = id()
		return file, nil
	}
	forwarded, created, e := p.ForwardMessage(ctx, a, original.ID, dest.ID, "request", copier)
	if e != nil || !created {
		t.Fatal("forward", e)
	}
	if forwarded.Body != "Original" || forwarded.AuthorID != a.ID || !forwarded.Forwarded || copies != 1 || forwarded.Attachments[0].ID == original.Attachments[0].ID {
		t.Fatal("incorrect independent copy")
	}
	again, created, e := p.ForwardMessage(ctx, a, original.ID, dest.ID, "request", copier)
	if e != nil || created || again.ID != forwarded.ID || copies != 1 {
		t.Fatal("duplicate", e)
	}
	if _, _, e = p.ForwardMessage(ctx, a, original.ID, source.ID, "request", copier); !errors.Is(e, ErrShareConflict) {
		t.Fatal("retry changed destination", e)
	}
	if _, _, e = p.ForwardMessage(ctx, c, original.ID, dest.ID, "blocked-source", copier); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("source access leaked", e)
	}
	if _, _, e = p.ForwardMessage(ctx, b, original.ID, dest.ID, "blocked-dest", copier); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("destination access leaked", e)
	}
	// Parallel retries must create only one message and one file copy.
	var wg sync.WaitGroup
	var ids [2]string
	var errs [2]error
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			m, _, err := p.ForwardMessage(ctx, a, original.ID, dest.ID, "parallel", copier)
			ids[i] = m.ID
			errs[i] = err
		}(i)
	}
	wg.Wait()
	if errs[0] != nil || errs[1] != nil || ids[0] != ids[1] || copies != 2 {
		t.Fatal("concurrent duplicate", errs)
	}
	if _, e = p.DeleteMessage(b, original.ID); e != nil {
		t.Fatal(e)
	}
	if _, _, e = p.ForwardMessage(ctx, a, original.ID, dest.ID, "deleted", copier); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("deleted source accepted", e)
	}
	if _, created, e = p.ForwardMessage(ctx, a, original.ID, dest.ID, "request", copier); e != nil || created {
		t.Fatal("lost response cannot recover after source deletion", e)
	}
	page, e := p.MessagesPage(c, dest.ID, "", 50)
	if e != nil || len(page.Messages) != 2 || !page.Messages[0].Forwarded || len(page.Messages[0].Attachments) != 1 {
		t.Fatal("forwarded content disappeared", e)
	}
	if _, _, e = p.AttachmentObject(c.ID, forwarded.Attachments[0].ID); e != nil {
		t.Fatal("recipient cannot read own copy", e)
	}
	if _, _, e = p.AttachmentObject(c.ID, original.Attachments[0].ID); e == nil {
		t.Fatal("recipient gained source access")
	}
	p.Pool.Exec(ctx, `DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`, dest.ID, a.ID)
	if _, _, e = p.ForwardMessage(ctx, a, original.ID, dest.ID, "request", copier); !errors.Is(e, chat.ErrForbidden) {
		t.Fatal("retry bypasses exclusion", e)
	}
}
