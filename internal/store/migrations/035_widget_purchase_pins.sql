-- Pins belong to a user, not to a shared purchase or a particular device.
CREATE TABLE widget_purchase_pins (
 user_id text NOT NULL,
 family_id text NOT NULL,
 item_id text NOT NULL REFERENCES shopping_items(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,item_id),
 FOREIGN KEY(family_id,user_id) REFERENCES family_members(family_id,user_id) ON DELETE CASCADE
);
