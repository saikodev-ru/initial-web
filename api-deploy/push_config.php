<?php
// ═══════════════════════════════════════════════════════════════
//  Web Push Configuration (VAPID)
//  Add these constants to your existing config.php
// ═══════════════════════════════════════════════════════════════

// VAPID keys — generated with: npx web-push generate-vapid-keys
// PUBLIC key is in js/push-subscribe.js (client-side, safe to expose)
// PRIVATE key stays here ONLY on the server — NEVER expose it!
define('WEB_PUSH_PRIVATE_KEY', 'M9rKCGZjsuH7j_BaxhLODfRGWD2QSVwIDu1Hp_TCEpU');

// Subject — used in the VAPID JWT. Must be a URL or mailto:.
define('WEB_PUSH_SUBJECT', 'mailto:push@initial.web');

// ── DB Migration ────────────────────────────────────────────
// Run this SQL once on your database:
//
//   ALTER TABLE `users` ADD COLUMN `push_subscription` TEXT NULL AFTER `fcm_token`;
//
// Or run: php migrate_push_subscription.php (see below)

// ── .htaccess (already covered by your existing API routing) ──
// Make sure these endpoints are accessible:
//   POST /api/save_push_subscription.php
//   POST /api/remove_push_subscription.php
