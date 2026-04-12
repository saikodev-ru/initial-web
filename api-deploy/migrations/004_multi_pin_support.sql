-- Migration 004: Allow multiple pinned messages per user per chat (Telegram-style)
-- Change unique key from (chat_id, user_id) to (chat_id, user_id, message_id)
-- This allows pinning multiple different messages, while preventing duplicates.

ALTER TABLE pinned_messages DROP INDEX uk_chat_user;
ALTER TABLE pinned_messages ADD UNIQUE KEY uk_chat_user_msg (chat_id, user_id, message_id);
