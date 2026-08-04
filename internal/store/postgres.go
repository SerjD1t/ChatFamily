package store

import (
	"context"
	"embed"
	"fmt"
	"sort"

	"familychat/internal/chat"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// Postgres owns the connection pool and schema versioning. Domain repositories
// will use this type in the next change instead of sharing a database handle.
type Postgres struct{ Pool *pgxpool.Pool }

func Open(ctx context.Context, databaseURL string) (*Postgres, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Postgres{Pool: pool}, nil
}

func (p *Postgres) Close() { p.Pool.Close() }

// Bootstrap creates the initial administrator and the family conversation.
// It is idempotent so every application start may safely call it.
func (p *Postgres) Bootstrap(ctx context.Context, admin chat.User) error {
	permissions := make([]string, 0, len(admin.Permissions))
	for permission, granted := range admin.Permissions {
		if granted {
			permissions = append(permissions, string(permission))
		}
	}
	sort.Strings(permissions)
	if _, err := p.Pool.Exec(ctx, `INSERT INTO users (id, email, display_name, password_hash, permissions)
		VALUES ($1, $2, $3, '', $4)
		ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, display_name=EXCLUDED.display_name, permissions=EXCLUDED.permissions`,
		admin.ID, admin.Email, admin.Name, permissions); err != nil {
		return fmt.Errorf("bootstrap administrator: %w", err)
	}
	if _, err := p.Pool.Exec(ctx, `INSERT INTO conversations (id, kind, title, created_by)
		VALUES ('family', 'family', 'Семья', $1) ON CONFLICT (id) DO NOTHING`, admin.ID); err != nil {
		return fmt.Errorf("bootstrap family conversation: %w", err)
	}
	if _, err := p.Pool.Exec(ctx, `INSERT INTO conversation_members (conversation_id, user_id)
		VALUES ('family', $1) ON CONFLICT DO NOTHING`, admin.ID); err != nil {
		return fmt.Errorf("bootstrap family member: %w", err)
	}
	return nil
}

func (p *Postgres) Migrate(ctx context.Context) error {
	if _, err := p.Pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		var applied bool
		if err := p.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)`, entry.Name()).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		sql, err := migrationFiles.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return err
		}
		tx, err := p.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, string(sql)); err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version) VALUES($1)`, entry.Name())
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migration %s: %w", entry.Name(), err)
		}
		if err = tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}
