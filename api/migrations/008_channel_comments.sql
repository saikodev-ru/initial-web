-- 008: Channel comments (Telegram-style nested comments under posts)

CREATE TABLE IF NOT EXISTS channel_comments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id INT UNSIGNED NOT NULL,
  channel_id INT UNSIGNED NOT NULL,
  sender_id INT UNSIGNED NOT NULL,
  body TEXT NULL,
  media_url VARCHAR(512) NULL,
  media_type VARCHAR(32) NULL,
  media_spoiler TINYINT(1) NOT NULL DEFAULT 0,
  sent_at INT UNSIGNED NOT NULL,
  is_edited TINYINT(1) NOT NULL DEFAULT 0,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_message (message_id),
  INDEX idx_channel (channel_id),
  INDEX idx_sender (sender_id),
  INDEX idx_channel_sent (channel_id, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add comments_count to channel_messages for fast counter
ALTER TABLE channel_messages
  ADD COLUMN comments_count INT UNSIGNED NOT NULL DEFAULT 0;

-- Add is_member flag to get_channel_info response (no schema change needed, just check membership)
