# Worklog — Voice Message 6 Fixes

**Branch:** `fix/voice-6-updates`
**Commit:** `1c4015e` (pushed to `origin/fix/voice-6-updates`)

## Summary

Applied 6 fixes to the voice message feature (257 lines removed, 2 added).

## Fix 1: Unified waveform style for locked/unlocked recording
- **File:** `css/style.css`
- Removed `-webkit-mask-image` and `mask-image` gradient from `.voice-rec-wave` (line 4293)
- Removed `-webkit-mask-image` and `mask-image` gradient from `.voice-locked-wave` (line 4347)
- Waveform bars now display at full width without left-side fade-out

## Fix 2: Animated mic→X icon transition + red button on cancel swipe
- **File:** `css/style.css`
- Fixed broken `@keyframes recBtnRing` — was missing closing brace, had cancel-swipe rules injected into the keyframe body
- Removed 3 duplicate copies of `.btn-voice-rec.cancel-swipe` rules (was duplicated 4 times total)
- Kept single clean copy with animated mic→X transition, red background, and proper `!important` overrides
- `.btn-voice-rec.recording` rule already correctly placed before cancel-swipe

## Fix 3: Swipe-to-cancel distance (verified, no changes)
- **File:** `js/voice-message.js` line 1015
- Confirmed: `const CANCEL_COMPLETE = wrap ? wrap.offsetWidth / 2 : CANCEL_COMPLETE_DEFAULT;`
- Left half of input field triggers full cancel — correct behavior

## Fix 4: Remove STT (transcription) button from voice bubble
- **Files:** `js/voice-message.js`, `js/messages.js`, `css/style.css`
- Removed STT cache constants (`STT_CACHE_PREFIX`, `STT_CACHE_MAX`, `STT_CACHE_TTL`)
- Removed STT button event wiring in `createPlayer()` (11 lines)
- Removed all STT functions: `_sttCacheKey`, `_getSttCache`, `_setSttCache`, `_pruneSttCache`, `restoreSttCache`, `_transcribeVoice`, `_resetSttButton` (~146 lines)
- Removed `restoreSttCache` from public API exports
- Removed STT button HTML from voice message template in `messages.js`
- Removed `.voice-stt-result` div from voice message template
- Removed all STT-related CSS (~56 lines): `.voice-stt-btn`, `.voice-stt-result`, `@keyframes sttSpin`, and state variants
- Verified zero remaining STT references across all 3 files

## Fix 5: Vertically align play button to waveform (verified, no changes needed)
- **File:** `css/style.css`
- `.voice-msg` already has `align-items: center` — no CSS override found
- Play button (36px) and waveform bars (28px) are correctly vertically centered via flex alignment

## Fix 6: Streaming upload (verified, no changes)
- Confirmed `sendVoice()` already shows upload progress ring on play button via `_showUploadProgress()`
