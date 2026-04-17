CREATE TABLE IF NOT EXISTS pinned_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    chat_id INT NOT NULL,
    message_id INT NOT NULL,
    user_id INT NOT NULL COMMENT 'who pinned it',
    pinned_for_all TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=all participants see, 0=only pinner',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_chat_user (chat_id, user_id),
    INDEX idx_chat (chat_id),
    INDEX idx_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
