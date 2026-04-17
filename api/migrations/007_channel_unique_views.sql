-- 007: Channel unique views tracking
-- Tracks which authenticated users have viewed which channel messages.
-- Each (user_id, message_id) pair is unique — view counted only once per user.

CREATE TABLE IF NOT EXISTS channel_message_views (
  user_id    INT NOT NULL,
  message_id INT NOT NULL,
  viewed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, message_id),
  INDEX idx_msg (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
