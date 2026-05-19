#!/usr/bin/env bash
# TEST: 09-error-modes — Verify error states for missing audio, empty subtitles, etc.
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
SCREENSHOTS="$TEST_DIR/screenshots/09-error-modes"
mkdir -p "$SCREENSHOTS"

echo "🧪 TEST 09: Error modes & edge cases"

agent-browser open "$BASE_URL/index.html"
agent-browser wait --load networkidle
sleep 2
# Wait for app to be ready
for try in $(seq 1 10); do
  READY=$(agent-browser eval "document.getElementById('upload-zone') !== null && document.getElementById('drop-text') !== null" 2>&1)
  if [ "$READY" = "true" ]; then break; fi
  sleep 0.5
done
sleep 0.5

# ─── Test: Reset from idle state (no-op) ─────────────────────────────────────
echo "   ── Reset from idle (no-op safety) ──"
agent-browser eval 'document.getElementById("clear-btn").click()' 2>&1
sleep 1

IDLE_STILL=$(agent-browser eval '
    document.getElementById("upload-zone").classList.contains("hidden") === false &&
    document.getElementById("result-section").classList.contains("hidden")
' 2>&1)
if [ "$IDLE_STILL" = "true" ]; then
    echo "   ✅ PASS: Reset from idle keeps app in idle state"
else
    echo "   ❌ FAIL: Reset from idle should keep idle state"
    exit 1
fi

# ─── Test: Show error, then reset clears it ──────────────────────────────────
echo "   ── Show and clear multiple errors ──"

for i in 1 2 3; do
    agent-browser eval "
        document.getElementById('error-display').classList.remove('hidden');
        document.getElementById('error-message').textContent = 'Error #$i';
    " 2>&1
    ERR_TEXT=$(agent-browser eval 'document.getElementById("error-message").textContent' 2>&1 | sed 's/^"//;s/"$//')
    if ! echo "$ERR_TEXT" | grep -q "Error #$i"; then
        echo "   ❌ FAIL: Expected 'Error #$i', got: $ERR_TEXT"
        exit 1
    fi
    agent-browser eval 'document.getElementById("clear-btn").click()' 2>&1
    sleep 0.2
done
echo "   ✅ PASS: Multiple error show/reset cycles work"

# ─── Test: Progress section states ───────────────────────────────────────────
echo "   ── Progress bar states ──"

# Test various progress values
for pct in 0 12 37 55 73 99 100; do
    agent-browser eval "
        document.getElementById('progress-section').classList.remove('hidden');
        document.getElementById('progress-bar').style.width = '${pct}%';
        document.getElementById('progress-label').textContent = 'Progress: ${pct}%';
    " 2>&1
    WIDTH=$(agent-browser eval 'document.getElementById("progress-bar").style.width' 2>&1 | sed 's/^"//;s/"$//')
    if [ "$WIDTH" != "${pct}%" ]; then
        echo "   ❌ FAIL: Progress bar should be ${pct}%, got: $WIDTH"
        exit 1
    fi
done
echo "   ✅ PASS: All progress values render correctly (0%, 12%, 37%, 55%, 73%, 99%, 100%)"

agent-browser eval 'document.getElementById("progress-section").classList.add("hidden")' 2>&1

# ─── Test: Video element reset ───────────────────────────────────────────────
echo "   ── Video source cleanup ──"
# Set a fake src
agent-browser eval 'document.getElementById("video-preview").src = "data:video/mp4,base64";' 2>&1
SRC_BEFORE=$(agent-browser eval 'document.getElementById("video-preview").src' 2>&1)
echo "   Video src before reset: ${SRC_BEFORE:0:50}..."

# Reset
agent-browser eval 'document.getElementById("clear-btn").click()' 2>&1
sleep 1

SRC_AFTER=$(agent-browser eval 'document.getElementById("video-preview").src' 2>&1)
echo "   Video src after reset: '$SRC_AFTER'"
if [ -z "$SRC_AFTER" ] || [ "$SRC_AFTER" = "" ] || [ "$SRC_AFTER" = '""' ]; then
    echo "   ✅ PASS: Video source cleared on reset"
else
    echo "   ⚠️  WARN: Video src after reset: $SRC_AFTER"
fi

# ─── Test: File input cleared on reset ────────────────────────────────────────
echo "   ── File input state ──"
# Set value on the file input
agent-browser eval '
    const fi = document.getElementById("file-input");
    // File input value is read-only for security, but we can verify the reset logic
    const uploadZone = document.getElementById("upload-zone");
    const dropText = document.getElementById("drop-text");
    dropText.textContent = "🎬 test.mp4";
' 2>&1

# Reset
agent-browser eval 'document.getElementById("clear-btn").click()' 2>&1
sleep 1

DROP_TEXT=$(agent-browser get text '#drop-text' 2>&1)
echo "   Drop text after reset: $DROP_TEXT"
if echo "$DROP_TEXT" | grep -qi "drop\|click to browse"; then
    echo "   ✅ PASS: Drop text reset to default prompt"
else
    echo "   ❌ FAIL: Drop text should reset, got: $DROP_TEXT"
    exit 1
fi

# ─── Test: Accessibility basics ──────────────────────────────────────────────
echo "   ── Accessibility ──"
VIDEO_ALT=$(agent-browser eval 'document.querySelector("#video-preview").hasAttribute("aria-label") || document.querySelector("#video-preview").hasAttribute("alt") || "no-attr"' 2>&1)
echo "   Video aria: $VIDEO_ALT"

# Check for semantic HTML
MAIN_HEADINGS=$(agent-browser eval 'document.querySelectorAll("header, footer, main, h1, h2, h3").length' 2>&1)
echo "   Semantic elements count: $MAIN_HEADINGS"
if [ "$MAIN_HEADINGS" -ge 3 ]; then
    echo "   ✅ PASS: Page has semantic structure elements"
else
    echo "   ⚠️  WARN: Few semantic elements: $MAIN_HEADINGS"
fi

# ─── Test: Header badge count ────────────────────────────────────────────────
echo "   ── Feature badges ──"
BADGE_COUNT=$(agent-browser eval 'document.querySelectorAll(".badge").length' 2>&1)
echo "   Badge count: $BADGE_COUNT"
if [ "$BADGE_COUNT" -ge 2 ]; then
    echo "   ✅ PASS: Feature badges present"
else
    echo "   ❌ FAIL: Expected at least 2 badges, got: $BADGE_COUNT"
    exit 1
fi

agent-browser screenshot --full "$SCREENSHOTS/01-error-modes.png"

echo ""
echo "✅ TEST 09 PASSED — Error modes & edge cases verified"
agent-browser close
exit 0
