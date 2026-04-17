-- ============================================================
--  Migration 002: Channels & Hubs tables
--  Telegram-style channels: admins post, subscribers view
--  Hubs are containers for channels (like Discord servers)
-- ============================================================

-- ── 1. Hubs (Хабы) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hubs (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    description     VARCHAR(500) DEFAULT '',
    avatar_url      VARCHAR(500) DEFAULT NULL,
    owner_id        INT NOT NULL,
    signal_id       VARCHAR(50) DEFAULT NULL,     -- unique @hub_id (optional)
    is_public       TINYINT(1) DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX idx_hubs_signal_id (signal_id),
    INDEX idx_hubs_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Hub members ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub_members (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    hub_id          INT NOT NULL,
    user_id         INT NOT NULL,
    role            ENUM('owner','admin','member') DEFAULT 'member',
    joined_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE INDEX idx_hm_hub_user (hub_id, user_id),
    INDEX idx_hm_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Channels (Каналы) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    hub_id          INT DEFAULT NULL,              -- NULL = standalone channel
    name            VARCHAR(100) NOT NULL,
    description     VARCHAR(500) DEFAULT '',
    avatar_url      VARCHAR(500) DEFAULT NULL,
    owner_id        INT NOT NULL,
    signal_id       VARCHAR(50) DEFAULT NULL,      -- unique @channel_id
    is_public       TINYINT(1) DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX idx_channels_signal_id (signal_id),
    INDEX idx_channels_hub (hub_id),
    INDEX idx_channels_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Channel subscribers ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_subscribers (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    channel_id      INT NOT NULL,
    user_id         INT NOT NULL,
    role            ENUM('owner','admin','subscriber') DEFAULT 'subscriber',
    subscribed_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE INDEX idx_cs_channel_user (channel_id, user_id),
    INDEX idx_cs_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. Channel messages ─────────────────────────────────────────
--  Reuses the same messages table but with channel_id field
--  OR we use a separate table for cleaner separation
CREATE TABLE IF NOT EXISTS channel_messages (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    channel_id      INT NOT NULL,
    sender_id       INT NOT NULL,
    body            TEXT DEFAULT NULL,
    media_url       VARCHAR(500) DEFAULT NULL,
    media_type      ENUM('image','video','document','voice') DEFAULT NULL,
    media_spoiler   TINYINT(1) DEFAULT 0,
    reply_to        INT DEFAULT NULL,
    is_edited       TINYINT(1) DEFAULT 0,
    is_deleted      TINYINT(1) DEFAULT 0,
    views_count     INT DEFAULT 0,
    forwarded_from  VARCHAR(100) DEFAULT NULL,
    batch_id        VARCHAR(64) DEFAULT NULL,
    voice_duration  INT DEFAULT NULL,
    voice_waveform  TEXT DEFAULT NULL,
    sent_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cm_channel_sent (channel_id, is_deleted, sent_at),
    INDEX idx_cm_channel_id (channel_id, id),
    INDEX idx_cm_sender (sender_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. Channel message reactions ────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_message_reactions (
    id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    message_id      INT NOT NULL,
    user_id         INT NOT NULL,
    emoji           VARCHAR(32) NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE INDEX idx_cmr_msg_user_emoji (message_id, user_id, emoji),
    INDEX idx_cmr_message (message_id, emoji)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 7. Auto-insert owner into hub_members & channel_subscribers ─
--  (handled by API code, not triggers)
