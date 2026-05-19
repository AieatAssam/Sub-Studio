#!/usr/bin/env bash
# TEST: 01-initial-state — Verify the app loads in its idle state
# RED phase: App should show upload zone, no results, no errors
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURES="$TEST_DIR/fixtures"
SCREENSHOTS="$TEST_DIR/screenshots/01-initial-state"
mkdir -p "$SCREENSHOTS"

echo "🧪 TEST 01: Initial state (idle)"

# ─── Navigate to the app ──────────────────────────────────────────────────────
agent-browser open "$BASE_URL/substudio/index.html"
agent-browser wait --load networkidle
sleep 1

# ─── Screenshot the initial state ─────────────────────────────────────────────
agent-browser screenshot "$SCREENSHOTS/01-initial-load.png"

# ─── Snapshot to discover elements ────────────────────────────────────────────
SNAPSHOT=$(agent-browser snapshot -i --json 2>&1)
echo "$SNAPSHOT" > "$SCREENSHOTS/snapshot.json"

# ─── Test: Page title is correct ──────────────────────────────────────────────
TITLE=$(agent-browser get title)
echo "   Page title: $TITLE"
if echo "$TITLE" | grep -qi "SubStudio"; then
    echo "   ✅ PASS: Page title contains 'SubStudio'"
else
    echo "   ❌ FAIL: Page title should contain 'SubStudio', got: $TITLE"
    exit 1
fi

# ─── Test: Upload zone is visible ─────────────────────────────────────────────
UPLOAD_TEXT=$(agent-browser get text '#drop-text' 2>/dev/null || echo "")
echo "   Upload text: $UPLOAD_TEXT"
if echo "$UPLOAD_TEXT" | grep -qi "video file"; then
    echo "   ✅ PASS: Upload zone shows drop prompt"
else
    echo "   ❌ FAIL: Upload zone should show drop prompt, got: $UPLOAD_TEXT"
    exit 1
fi

# ─── Test: Progress section is hidden ─────────────────────────────────────────
# Check if progress section has 'hidden' class
HIDDEN_CHECK=$(agent-browser eval "document.getElementById('progress-section').classList.contains('hidden')" 2>&1)
echo "   Progress section hidden: $HIDDEN_CHECK"
if [ "$HIDDEN_CHECK" = "true" ]; then
    echo "   ✅ PASS: Progress section is hidden on load"
else
    echo "   ❌ FAIL: Progress section should be hidden on load"
    exit 1
fi

# ─── Test: Error display is hidden ────────────────────────────────────────────
ERROR_HIDDEN=$(agent-browser eval "document.getElementById('error-display').classList.contains('hidden')" 2>&1)
echo "   Error display hidden: $ERROR_HIDDEN"
if [ "$ERROR_HIDDEN" = "true" ]; then
    echo "   ✅ PASS: Error display is hidden on load"
else
    echo "   ❌ FAIL: Error display should be hidden on load"
    exit 1
fi

# ─── Test: Result section is hidden ───────────────────────────────────────────
RESULT_HIDDEN=$(agent-browser eval "document.getElementById('result-section').classList.contains('hidden')" 2>&1)
echo "   Result section hidden: $RESULT_HIDDEN"
if [ "$RESULT_HIDDEN" = "true" ]; then
    echo "   ✅ PASS: Result section is hidden on load"
else
    echo "   ❌ FAIL: Result section should be hidden on load"
    exit 1
fi

# ─── Test: Video container is hidden ──────────────────────────────────────────
VIDEO_HIDDEN=$(agent-browser eval "document.getElementById('video-container').classList.contains('hidden')" 2>&1)
echo "   Video container hidden: $VIDEO_HIDDEN"
if [ "$VIDEO_HIDDEN" = "true" ]; then
    echo "   ✅ PASS: Video container is hidden on load"
else
    echo "   ❌ FAIL: Video container should be hidden on load"
    exit 1
fi

# ─── Test: Footer has badges ──────────────────────────────────────────────────
FOOTER_TEXT=$(agent-browser eval "document.querySelector('footer').textContent" 2>&1)
if echo "$FOOTER_TEXT" | grep -qi "no API"; then
    echo "   ✅ PASS: Footer mentions no API keys"
else
    echo "   ⚠️  WARN: Footer doesn't mention no API keys (non-critical)"
fi

echo ""
echo "✅ TEST 01 PASSED — All initial state checks verified"
agent-browser close
exit 0
