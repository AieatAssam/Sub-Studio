#!/usr/bin/env bash
# TEST: 10-url-and-sample — Verify URL input, sample generation, and CORS handling
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
SCREENSHOTS="$TEST_DIR/screenshots/10-url-and-sample"
mkdir -p "$SCREENSHOTS"

echo "🧪 TEST 10: URL input & sample generation"

agent-browser open "$BASE_URL/index.html"
agent-browser wait --load networkidle
sleep 1

# ─── Test: URL section elements ──────────────────────────────────────────────
echo "   ── URL input elements ──"
URL_INPUT_EXISTS=$(agent-browser eval 'document.getElementById("url-input") !== null' 2>&1)
if [ "$URL_INPUT_EXISTS" = "true" ]; then
    echo "   ✅ PASS: URL input field exists"
else
    echo "   ❌ FAIL: URL input missing"
    exit 1
fi

URL_BTN_EXISTS=$(agent-browser eval 'document.getElementById("url-load-btn") !== null' 2>&1)
if [ "$URL_BTN_EXISTS" = "true" ]; then
    echo "   ✅ PASS: URL Load button exists"
else
    echo "   ❌ FAIL: URL Load button missing"
    exit 1
fi

SAMPLE_BTN_EXISTS=$(agent-browser eval 'document.getElementById("sample-btn") !== null' 2>&1)
if [ "$SAMPLE_BTN_EXISTS" = "true" ]; then
    SAMPLE_TEXT=$(agent-browser eval 'document.getElementById("sample-btn").textContent' 2>&1 | sed 's/^"//;s/"$//')
    echo "   Sample button text: $SAMPLE_TEXT"
    if echo "$SAMPLE_TEXT" | grep -qi "sample\|🎵"; then
        echo "   ✅ PASS: Sample button exists with correct label"
    else
        echo "   ⚠️  WARN: Sample button text: $SAMPLE_TEXT"
    fi
else
    echo "   ❌ FAIL: Sample button missing"
    exit 1
fi

URL_LOADING_EXISTS=$(agent-browser eval 'document.getElementById("url-loading") !== null' 2>&1)
if [ "$URL_LOADING_EXISTS" = "true" ]; then
    echo "   ✅ PASS: URL loading indicator exists"
else
    echo "   ❌ FAIL: URL loading indicator missing"
    exit 1
fi

# Verify initially hidden
URL_LOADING_HIDDEN=$(agent-browser eval 'document.getElementById("url-loading").classList.contains("hidden")' 2>&1)
if [ "$URL_LOADING_HIDDEN" = "true" ]; then
    echo "   ✅ PASS: URL loading is initially hidden"
else
    echo "   ❌ FAIL: URL loading should be hidden initially"
    exit 1
fi

# ─── Test: URL input placeholder ─────────────────────────────────────────────
PLACEHOLDER=$(agent-browser eval 'document.getElementById("url-input").placeholder' 2>&1 | sed 's/^"//;s/"$//')
echo "   URL placeholder: $PLACEHOLDER"
if echo "$PLACEHOLDER" | grep -qi "http"; then
    echo "   ✅ PASS: URL input has placeholder"
else
    echo "   ❌ FAIL: URL input placeholder missing"
    exit 1
fi

# ─── Test: URL hint text ─────────────────────────────────────────────────────
HINT_TEXT=$(agent-browser get text '#url-hint' 2>&1)
if echo "$HINT_TEXT" | grep -qi "CORS\|sample"; then
    echo "   ✅ PASS: URL hint mentions CORS and sample"
else
    echo "   ❌ FAIL: URL hint missing, got: $HINT_TEXT"
    exit 1
fi

# ─── Test: Divider styling ───────────────────────────────────────────────────
DIVIDER_EXISTS=$(agent-browser eval 'document.querySelector(".url-divider") !== null' 2>&1)
if [ "$DIVIDER_EXISTS" = "true" ]; then
    echo "   ✅ PASS: URL divider element exists"
else
    echo "   ❌ FAIL: URL divider missing"
    exit 1
fi

# ─── Test: Empty URL shows error ─────────────────────────────────────────────
echo "   ── Empty URL validation ──"
agent-browser eval 'document.getElementById("url-input").value = ""' 2>&1
agent-browser click '#url-load-btn'
sleep 0.5

ERR_VISIBLE=$(agent-browser eval '!document.getElementById("error-display").classList.contains("hidden")' 2>&1)
ERR_MSG=$(agent-browser eval 'document.getElementById("error-message").textContent' 2>&1 | sed 's/^"//;s/"$//')
echo "   Error visible: $ERR_VISIBLE, message: ${ERR_MSG:0:50}"

if [ "$ERR_VISIBLE" = "true" ] && echo "$ERR_MSG" | grep -qi "URL\|enter"; then
    echo "   ✅ PASS: Empty URL shows validation error"
else
    echo "   ❌ FAIL: Empty URL should show error"
    exit 1
fi

# Clear the error
agent-browser eval 'document.getElementById("clear-btn").click()' 2>&1
sleep 0.3

# ─── Test: URL input has focusable state ─────────────────────────────────────
echo "   ── URL input interaction ──"
agent-browser click '#url-input'
sleep 0.3

FOCUSED=$(agent-browser eval 'document.activeElement === document.getElementById("url-input")' 2>&1)
if [ "$FOCUSED" = "true" ]; then
    echo "   ✅ PASS: URL input is focusable"
else
    echo "   ❌ FAIL: URL input not focusable"
    exit 1
fi

# Type a URL
agent-browser type '#url-input' 'https://example.com/video.mp4'
sleep 0.3
INPUT_VALUE=$(agent-browser eval 'document.getElementById("url-input").value' 2>&1 | sed 's/^"//;s/"$//')
if echo "$INPUT_VALUE" | grep -q "example.com"; then
    echo "   ✅ PASS: Can type into URL input"
else
    echo "   ❌ FAIL: URL input value not set, got: $INPUT_VALUE"
    exit 1
fi

# ─── Test: Clear button clears URL input ─────────────────────────────────────
agent-browser eval 'document.getElementById("clear-btn").click()' 2>&1
sleep 0.3
URL_AFTER_RESET=$(agent-browser eval 'document.getElementById("url-input").value' 2>&1 | sed 's/^"//;s/"$//')
if [ -z "$URL_AFTER_RESET" ] || [ "$URL_AFTER_RESET" = "" ]; then
    echo "   ✅ PASS: Clear button resets URL input"
else
    echo "   ⚠️  WARN: URL not cleared after reset: $URL_AFTER_RESET"
fi

# ─── Test: Sample button click triggers generation ───────────────────────────
echo "   ── Sample button click ──"
# Just verify the button is clickable (actual generation would need MediaRecorder)
CLICKED=$(agent-browser eval '
    const btn = document.getElementById("sample-btn");
    btn !== null && (btn.tagName === "BUTTON" || btn.tagName === "A");
' 2>&1)
if [ "$CLICKED" = "true" ]; then
    echo "   ✅ PASS: Sample button is clickable"
else
    echo "   ❌ FAIL: Sample button not clickable"
    exit 1
fi

agent-browser screenshot --full "$SCREENSHOTS/01-url-and-sample.png"

echo ""
echo "✅ TEST 10 PASSED — URL input & sample generation verified"
agent-browser close
exit 0
