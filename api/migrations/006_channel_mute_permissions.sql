-- Migration 006 - Channel mute + permissions

-- Add muted flag to channel_members
ALTER TABLE channel_members
  ADD COLUMN muted TINYINT(1) NOT NULL DEFAULT 0;

-- Add channel permission columns
ALTER TABLE channels
  ADD COLUMN slow_mode_seconds INT UNSIGNED NOT NULL DEFAULT 0 AFTER invite_link_hash,
  ADD COLUMN who_can_post ENUM('admins','all') NOT NULL DEFAULT 'admins' AFTER slow_mode_seconds;
