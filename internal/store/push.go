package store

import (
	"context"
	"strings"

	"familychat/internal/chat"
	"github.com/SherClockHolmes/webpush-go"
)

func (p *Postgres) SavePushSubscription(actor chat.User, subscription webpush.Subscription) error {
	if strings.TrimSpace(subscription.Endpoint) == "" || strings.TrimSpace(subscription.Keys.P256dh) == "" || strings.TrimSpace(subscription.Keys.Auth) == "" {
		return chat.ErrInvalid
	}
	_, err := p.Pool.Exec(context.Background(), `INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth) VALUES($1,$2,$3,$4) ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,updated_at=now()`, subscription.Endpoint, actor.ID, subscription.Keys.P256dh, subscription.Keys.Auth)
	return err
}

func (p *Postgres) DeletePushSubscription(actor chat.User, endpoint string) error {
	_, err := p.Pool.Exec(context.Background(), `DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2`, endpoint, actor.ID)
	return err
}

func (p *Postgres) PushSubscriptions(conversationID, excludedUserID string) ([]webpush.Subscription, error) {
	rows, err := p.Pool.Query(context.Background(), `SELECT s.endpoint,s.p256dh,s.auth FROM push_subscriptions s JOIN conversation_members m ON m.user_id=s.user_id WHERE m.conversation_id=$1 AND s.user_id<>$2`, conversationID, excludedUserID)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []webpush.Subscription
	for rows.Next() { var s webpush.Subscription; if err := rows.Scan(&s.Endpoint,&s.Keys.P256dh,&s.Keys.Auth); err != nil { return nil, err }; out=append(out,s) }
	return out, rows.Err()
}

func (p *Postgres) RemovePushEndpoint(endpoint string) { _, _ = p.Pool.Exec(context.Background(), `DELETE FROM push_subscriptions WHERE endpoint=$1`, endpoint) }
