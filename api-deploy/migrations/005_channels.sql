-- ═══════════════════════════════════════════════════════════════
--  Migration 005 — Telegram-like Channels
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS channels (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id INT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  username VARCHAR(32) NULL UNIQUE,
  description VARCHAR(512) NULL,
  avatar_url VARCHAR(512) NULL,
  type ENUM('public','private') NOT NULL DEFAULT 'public',
  invite_link_hash VARCHAR(64) NULL UNIQUE,
  members_count INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username),
  INDEX idx_owner (owner_id),
  INDEX idx_invite_link (invite_link_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_members (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  channel_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  role ENUM('owner','admin','member') NOT NULL DEFAULT 'member',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_read_message_id INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uk_channel_user (channel_id, user_id),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_messages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  channel_id INT UNSIGNED NOT NULL,
  sender_id INT UNSIGNED NOT NULL,
  body TEXT NULL,
  media_url VARCHAR(512) NULL,
  media_type VARCHAR(32) NULL,
  media_spoiler TINYINT(1) NOT NULL DEFAULT 0,
  batch_id VARCHAR(64) NULL,
  reply_to INT UNSIGNED NULL,
  media_file_name VARCHAR(256) NULL,
  media_file_size BIGINT UNSIGNED NULL,
  sent_at INT UNSIGNED NOT NULL,
  is_edited TINYINT(1) NOT NULL DEFAULT 0,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  views_count INT UNSIGNED NOT NULL DEFAULT 0,
  INDEX idx_channel_sent (channel_id, sent_at),
  INDEX idx_sender (sender_id),
  INDEX idx_channel_id (channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_pinned (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  channel_id INT UNSIGNED NOT NULL,
  message_id INT UNSIGNED NOT NULL,
  pinned_by INT UNSIGNED NOT NULL,
  pinned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_channel (channel_id),
  INDEX idx_channel_message (channel_id, message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_reactions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  emoji VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_message_user_emoji (message_id, user_id, emoji),
  INDEX idx_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
