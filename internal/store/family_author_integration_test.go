package store

import (
	"context"
	"os"
	"testing"
)

func TestFamilyAuthorLabels(t *testing.T) {
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
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO users(id,email,display_name,first_name,last_name,password_hash) VALUES('test_label_user','label@example.test','Test Surname','Test','Surname','');
 INSERT INTO families(id,title) VALUES('test_label_f1','Family 1'),('test_label_f2','Family 2');
 INSERT INTO family_members(family_id,user_id,relationship) VALUES('test_label_f1','test_label_user','Мама'),('test_label_f2','test_label_user','Бабушка');
 INSERT INTO conversations(id,kind,family_id) VALUES('test_label_c1','family','test_label_f1'),('test_label_c2','family','test_label_f2'),('test_label_direct','direct',NULL),('test_label_group','group',NULL);`)
	if err != nil {
		t.Fatal(err)
	}
	for cid, want := range map[string]string{"test_label_c1": "Мама (Test)", "test_label_c2": "Бабушка (Test)", "test_label_direct": "Test Surname", "test_label_group": "Test Surname"} {
		var got string
		if err = tx.QueryRow(ctx, `SELECT chat_author_label('test_label_user',$1)`, cid).Scan(&got); err != nil || got != want {
			t.Fatalf("label mismatch for %s: %q, err %v", cid, got, err)
		}
	}
	for _, status := range []string{"", "Неопределено", "   ", " Неопределено "} {
		if _, err = tx.Exec(ctx, `UPDATE family_members SET relationship=$1 WHERE family_id='test_label_f1'`, status); err != nil {
			t.Fatal(err)
		}
		var got string
		err = tx.QueryRow(ctx, `SELECT chat_author_label('test_label_user','test_label_c1')`).Scan(&got)
		if err != nil || got != "Test" {
			t.Fatal("empty status fallback", got, err)
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE family_members SET relationship='  Родитель  ' WHERE family_id='test_label_f1'; UPDATE users SET first_name='  Test  ' WHERE id='test_label_user'`); err != nil {
		t.Fatal(err)
	}
	var got string
	if err = tx.QueryRow(ctx, `SELECT chat_author_label('test_label_user','test_label_c1')`).Scan(&got); err != nil || got != "Родитель (Test)" {
		t.Fatal("trimmed label", got, err)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM family_members WHERE family_id='test_label_f1' AND user_id='test_label_user'`); err != nil {
		t.Fatal(err)
	}
	if err = tx.QueryRow(ctx, `SELECT chat_author_label('test_label_user','test_label_c1')`).Scan(&got); err != nil || got != "Test" {
		t.Fatal("former member fallback", got, err)
	}
}
