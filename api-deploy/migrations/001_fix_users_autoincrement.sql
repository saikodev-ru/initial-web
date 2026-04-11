-- ============================================================
--  Migration 001: Fix users table PRIMARY KEY + indexes
--  Run ONCE on the production database.
--  After running, verify with: SHOW CREATE TABLE users;
-- ============================================================

-- ── 1. Fix existing row with id=0 (if any) ──────────────────
-- Save current max id, then move id=0 to max+1
SET @max_id = (SELECT COALESCE(MAX(id), 0) FROM users);
UPDATE users SET id = @max_id + 1 WHERE id = 0;
-- Update all references: sessions, chats, messages
UPDATE sessions SET user_id = @max_id + 1 WHERE user_id = 0;
UPDATE chats SET user_a = @max_id + 1 WHERE user_a = 0;
UPDATE chats SET user_b = @max_id + 1 WHERE user_b = 0;
UPDATE messages SET sender_id = @max_id + 1 WHERE sender_id = 0;
UPDATE message_reactions SET user_id = @max_id + 1 WHERE user_id = 0;

-- ── 2. Ensure AUTO_INCREMENT on users.id ─────────────────────
ALTER TABLE users MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT PRIMARY KEY;

-- ── 3. Add UNIQUE on email (if not exists) ───────────────────
-- Suppress error if index already exists
SET @exists = (SELECT COUNT(*) FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_email');
SET @sql = IF(@exists = 0,
    'ALTER TABLE users ADD UNIQUE INDEX idx_users_email (email)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 4. Performance indexes ───────────────────────────────────
-- auth_codes: lookup by email + status + expiry
SET @idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_codes' AND INDEX_NAME = 'idx_ac_email_used_exp');
SET @sql = IF(@idx = 0,
    'CREATE INDEX idx_ac_email_used_exp ON auth_codes (email, used, expires_at)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- messages: chat loading + unread counts
SET @idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND INDEX_NAME = 'idx_msg_chat_sent');
SET @sql = IF(@idx = 0,
    'CREATE INDEX idx_msg_chat_sent ON messages (chat_id, is_deleted, sent_at)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND INDEX_NAME = 'idx_msg_chat_unread');
SET @sql = IF(@idx = 0,
    'CREATE INDEX idx_msg_chat_unread ON messages (chat_id, sender_id, is_read, is_deleted)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- chats: user lookup (both directions)
SET @idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chats' AND INDEX_NAME = 'idx_chats_users');
SET @sql = IF(@idx = 0,
    'CREATE INDEX idx_chats_users ON chats (user_a, user_b)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chats' AND INDEX_NAME = 'idx_chats_user_b');
SET @sql = IF(@idx = 0,
    'CREATE INDEX idx_chats_user_b ON chats (user_b, user_a)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- sessions: token lookup
SET @idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sessions' AND INDEX_NAME = 'idx_sessions_token');
SET @sql = IF(@idx = 0,
    'CREATE INDEX idx_sessions_token ON sessions (token, expires_at)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- message_reactions: lookup by message
SET @idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'message_reactions' AND INDEX_NAME = 'idx_react_msg');
SET @sql = IF(@idx = 0,
    'CREATE INDEX idx_react_msg ON message_reactions (message_id, emoji)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ip_limit_log: cleanup
SET @idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_limit_log' AND INDEX_NAME = 'idx_ipl_ip_time');
SET @sql = IF(@idx = 0,
    'CREATE INDEX idx_ipl_ip_time ON ip_limit_log (ip, created_at)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 5. Fix AUTO_INCREMENT counter ────────────────────────────
-- Ensure next auto-increment is at least MAX(id) + 1
SET @next_ai = (SELECT COALESCE(MAX(id), 0) + 1 FROM users);
SET @sql = CONCAT('ALTER TABLE users AUTO_INCREMENT = ', @next_ai);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
