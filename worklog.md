---
Task ID: 2
Agent: sub
Task: Implement 6 UI/UX improvements

Work Log:
- **Task 1 — Fix avatar thumbnails (.mavi) not loading**: Root cause was field name mismatch. API (`get_messages.php`) returns `sender_name` and `sender_avatar`, but JS code used `m.nickname` and `m.avatar_url`. Added `_normMsg()`/`_normMsgs()` normalization in `js/messages.js` that maps API fields to internal names. Applied normalization at all 3 message ingestion points: init fetch, poll fetch, and history load.
- **Task 2 — Hide .mavi on mobile CSS**: Added `.mavi { display: none !important; }` rule inside `@container app (max-width: 680px)` block in `css/style.css`. JS avatar code preserved for future group chat re-enablement.
- **Task 3 — Rework mobile message interaction**: Replaced the 300ms delayed short-press with instant single-tap behavior. On `touchend` (no move, not blocked, not long-pressed) → immediately shows dim overlay + context menu. Long press at 700ms triggers selection mode with haptic. Added `_longFired` flag to prevent context menu from firing after a long press.
- **Task 4 — Optimize message delivery**: Replaced disabled `startSSE()` stub with a full long-polling implementation using `poll_updates.php`. Server holds connection up to 25s, returns instantly on new data. Client reconnects immediately after each response. Processes messages (with dedup + DOM append), typing indicators, call signals, and chat list updates. On error, falls back to 3s retry. Reduced base polling from 3000ms → 2500ms and hidden tab from 15000ms → 8000ms. Updated `logout()` in `auth.js` and `openChat()` in `chat-list.js` to use `stopSSE()` instead of `S.sse.close()`.
- **Task 5 — In-app push improvements (CSS)**: Avatar 38→44px, inner padding 6px 8px→8px 10px, name font 13→14px, message font 12.5→13px, content gap 0→3px. **(JS reliability)**: Added DOMContentLoaded guard, same-chat debounce (updates content in-place without animation reset), different-chat debounce (hides old, shows new after 300ms), increased auto-hide timeout 5000→6000ms.
- **Task 6 — Mobile navbar + chat header avatar**: Bottom nav padding 0 4px→0 8px, nav indicator width 56→60px for better alignment. Chat header avatar pill 66→74px with padding 5px, avatar image 58→64px.
- Committed as b813d87, pushed to origin/new-ui-fix successfully.

Stage Summary:
- 6 files changed, 239 insertions, 49 deletions
- All 6 tasks completed
- No blocking issues found

---
Task ID: 1
Agent: main
Task: Fix critical registration bug + comprehensive API refactoring

Work Log:
- Cloned repository from GitHub (branch new-ui-fix)
- Read and analyzed all 30+ PHP files in api-deploy/
- Diagnosed root cause: users.id NOT AUTO_INCREMENT → Duplicate entry '0' on INSERT
- Created database migration script (migrations/001_fix_users_autoincrement.sql)
- Rewrote verify_code.php with transactional user creation
- Improved send_code.php with email cooldown
- Hardened helpers.php (DB reconnect, strict token validation, find_or_create_chat)
- Improved security.php (IP spoofing protection, expanded email blocklist)
- Optimized get_messages.php (eliminated correlated subqueries in fetch_chats)
- Updated send_message.php to use shared find_or_create_chat()
- Improved poll_updates.php (connection_aborted, cursor validation)
- Hardened delete_chat.php (blocks protected chats deletion)
- Fixed sessions.php (removed insecure fallback)
- Improved update_profile.php (sanitize inputs, validate_signal_id)
- Committed all changes to new-ui-fix branch (a3bb477)
- Push failed (no GitHub auth in sandbox)

Stage Summary:
- 11 files changed, 440 insertions, 203 deletions
- Critical bug fixed: registration now uses transactions + explicit IDs
- 8 performance indexes added via migration script
- User needs to run migration SQL on production database
- User needs to push manually: git push origin new-ui-fix
