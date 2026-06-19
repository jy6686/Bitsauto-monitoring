-- T003: User favorites / pinned strip
CREATE TABLE IF NOT EXISTS user_favorites (
  id          serial PRIMARY KEY,
  user_id     text NOT NULL,
  module_key  text NOT NULL,
  portal_key  text,
  label       text,
  icon        text NOT NULL DEFAULT 'circle',
  route       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT now(),
  UNIQUE(user_id, module_key)
);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id);
