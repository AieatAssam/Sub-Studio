#!/usr/bin/env bash
# TEST: 03-ui-elements — Verify all UI elements render correctly
# RED phase: All interactive elements must exist with correct labels
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
SCREENSHOTS="$TEST_DIR/screenshots/03-ui-elements"
mkdir -p "$SCREENSHOTS"

echo "🧪 TEST 03: UI elements and layout"

# Helper: extract raw text from agent-browser eval output (strip JSON quotes)
raw() { sed 's/^"//;s/"$//'; }

# ─── Load the app ─────────────────────────────────────────────────────────────
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

# ─── Test: Header elements ────────────────────────────────────────────────────
echo "   ── Header ──"
LOGO_TEXT=$(agent-browser get text '.logo' 2>&1)
echo "   Logo text: $(echo "$LOGO_TEXT" | head -c 80)"
if echo "$LOGO_TEXT" | grep -qi "SubStudio"; then
    echo "   ✅ PASS: Logo shows 'SubStudio'"
else
    echo "   ❌ FAIL: Logo missing 'SubStudio'"
    exit 1
fi

LOCAL_BADGE=$(agent-browser eval 'document.querySelector(".badge.local")?.textContent' 2>&1 | raw)
echo "   Local badge: $LOCAL_BADGE"
if echo "$LOCAL_BADGE" | grep -qi "local"; then
    echo "   ✅ PASS: Privacy badge present"
else
    echo "   ❌ FAIL: Privacy badge missing"
    exit 1
fi

# ─── Test: Upload zone ────────────────────────────────────────────────────────
echo "   ── Upload Zone ──"

# Check upload zone exists
ZONE_EXISTS=$(agent-browser eval 'document.getElementById("upload-zone") !== null' 2>&1)
if [ "$ZONE_EXISTS" = "true" ]; then
    echo "   ✅ PASS: Upload zone exists"
else
    echo "   ❌ FAIL: Upload zone missing"
    exit 1
fi

# Upload zone is visible (no 'hidden' class)
ZONE_VISIBLE=$(agent-browser eval 'document.getElementById("upload-zone").classList.contains("hidden")' 2>&1)
if [ "$ZONE_VISIBLE" = "false" ]; then
    echo "   ✅ PASS: Upload zone is visible"
else
    echo "   ❌ FAIL: Upload zone should be visible"
    exit 1
fi

DROP_TEXT=$(agent-browser get text '#drop-text' 2>&1)
if echo "$DROP_TEXT" | grep -qi "drop\|video"; then
    echo "   ✅ PASS: Drop instruction text present"
else
    echo "   ❌ FAIL: Drop instruction text missing, got: $DROP_TEXT"
    exit 1
fi

HINT_TEXT=$(agent-browser eval 'document.querySelector("#upload-zone .hint")?.textContent' 2>&1 | raw)
echo "   Hint: $HINT_TEXT"
if echo "$HINT_TEXT" | grep -qi "MP4\|MKV\|GB"; then
    echo "   ✅ PASS: Supported formats hint present"
else
    echo "   ❌ FAIL: Supported formats hint missing"
    exit 1
fi

# ─── Test: File input exists and is hidden ────────────────────────────────────
FILE_INPUT_EXISTS=$(agent-browser eval 'document.getElementById("file-input") !== null' 2>&1)
echo "   File input exists: $FILE_INPUT_EXISTS"
if [ "$FILE_INPUT_EXISTS" = "true" ]; then
    echo "   ✅ PASS: File input exists in DOM"
else
    echo "   ❌ FAIL: File input missing from DOM"
    exit 1
fi

FILE_INPUT_TYPE=$(agent-browser eval 'document.getElementById("file-input")?.type' 2>&1 | raw)
echo "   File input type: $FILE_INPUT_TYPE"
if [ "$FILE_INPUT_TYPE" = "file" ]; then
    echo "   ✅ PASS: File input type is 'file'"
else
    echo "   ❌ FAIL: File input type should be 'file', got: $FILE_INPUT_TYPE"
    exit 1
fi

FILE_INPUT_ACCEPT=$(agent-browser eval 'document.getElementById("file-input")?.accept' 2>&1 | raw)
echo "   File input accept: $FILE_INPUT_ACCEPT"
if echo "$FILE_INPUT_ACCEPT" | grep -qi "video"; then
    echo "   ✅ PASS: File input accepts video/*"
else
    echo "   ❌ FAIL: File input should accept video/*"
    exit 1
fi

# ─── Test: Video player elements ──────────────────────────────────────────────
echo "   ── Video Player ──"
VIDEO_ELEMENT=$(agent-browser eval 'document.getElementById("video-preview")?.tagName' 2>&1 | raw)
if [ "$VIDEO_ELEMENT" = "VIDEO" ]; then
    echo "   ✅ PASS: Video element exists"
else
    echo "   ❌ FAIL: Video element missing, got: $VIDEO_ELEMENT"
    exit 1
fi

VIDEO_CONTAINER_HIDDEN=$(agent-browser eval 'document.getElementById("video-container").classList.contains("hidden")' 2>&1)
if [ "$VIDEO_CONTAINER_HIDDEN" = "true" ]; then
    echo "   ✅ PASS: Video container is initially hidden"
else
    echo "   ❌ FAIL: Video container should be hidden initially"
    exit 1
fi

TRACK_ELEMENT=$(agent-browser eval 'document.getElementById("subtitle-track")?.tagName' 2>&1 | raw)
if [ "$TRACK_ELEMENT" = "TRACK" ]; then
    echo "   ✅ PASS: Subtitle track element exists"
else
    echo "   ❌ FAIL: Subtitle track element missing"
    exit 1
fi

# Overlay removed — subtitles rendered natively via <track> element
# Verified above by TRACK_ELEMENT check

# ─── Test: Progress section elements ──────────────────────────────────────────
echo "   ── Progress Section ──"
for el_id in progress-bar progress-label status-icon; do
    EXISTS=$(agent-browser eval "document.getElementById('$el_id') !== null" 2>&1)
    if [ "$EXISTS" = "true" ]; then
        echo "   ✅ PASS: #$el_id exists"
    else
        echo "   ❌ FAIL: #$el_id missing"
        exit 1
    fi
done

SECTION_HIDDEN=$(agent-browser eval 'document.getElementById("progress-section").classList.contains("hidden")' 2>&1)
if [ "$SECTION_HIDDEN" = "true" ]; then
    echo "   ✅ PASS: Progress section is initially hidden"
else
    echo "   ❌ FAIL: Progress section should be hidden"
    exit 1
fi

# ─── Test: Result section elements ────────────────────────────────────────────
echo "   ── Result Section ──"
EDITOR_EXISTS=$(agent-browser eval 'document.getElementById("subtitle-editor") !== null' 2>&1)
if [ "$EDITOR_EXISTS" = "true" ]; then
    echo "   ✅ PASS: Subtitle editor exists"
else
    echo "   ❌ FAIL: Subtitle editor missing"
    exit 1
fi

SELECT_EXISTS=$(agent-browser eval 'document.getElementById("format-select") !== null' 2>&1)
if [ "$SELECT_EXISTS" = "true" ]; then
    echo "   ✅ PASS: Format select exists"
else
    echo "   ❌ FAIL: Format select missing"
    exit 1
fi

# Verify format options
OPTIONS=$(agent-browser eval "JSON.stringify(Array.from(document.querySelectorAll('#format-select option')).map(o => o.value))" 2>&1)
echo "   Format options: $OPTIONS"
if echo "$OPTIONS" | grep -q "srt" && echo "$OPTIONS" | grep -q "vtt"; then
    echo "   ✅ PASS: SRT and VTT format options present"
else
    echo "   ❌ FAIL: Missing SRT or VTT format options"
    exit 1
fi

# Buttons
BTN_COPY=$(agent-browser eval 'document.getElementById("copy-btn") !== null' 2>&1)
BTN_DOWNLOAD=$(agent-browser eval 'document.getElementById("download-btn") !== null' 2>&1)
BTN_CLEAR=$(agent-browser eval 'document.getElementById("clear-btn") !== null' 2>&1)

if [ "$BTN_COPY" = "true" ] && [ "$BTN_DOWNLOAD" = "true" ] && [ "$BTN_CLEAR" = "true" ]; then
    echo "   ✅ PASS: All control buttons exist (copy, download, clear)"
else
    echo "   ❌ FAIL: Missing buttons — copy:$BTN_COPY download:$BTN_DOWNLOAD clear:$BTN_CLEAR"
    exit 1
fi

# ─── Test: Stats section elements ─────────────────────────────────────────────
echo "   ── Stats Section ──"
STATS_EXISTS=$(agent-browser eval 'document.getElementById("stats-section") !== null' 2>&1)
if [ "$STATS_EXISTS" = "true" ]; then
    echo "   ✅ PASS: Stats section exists"
else
    echo "   ❌ FAIL: Stats section missing"
    exit 1
fi

STATS_HIDDEN=$(agent-browser eval 'document.getElementById("stats-section").classList.contains("hidden")' 2>&1)
if [ "$STATS_HIDDEN" = "true" ]; then
    echo "   ✅ PASS: Stats section is initially hidden"
else
    echo "   ❌ FAIL: Stats section should be hidden"
    exit 1
fi

# ─── Test: Footer ─────────────────────────────────────────────────────────────
echo "   ── Footer ──"
FOOTER_LINKS=$(agent-browser eval 'document.querySelectorAll("footer a").length' 2>&1)
echo "   Footer links count: $FOOTER_LINKS"
if [ "$FOOTER_LINKS" -ge 2 ]; then
    echo "   ✅ PASS: Footer has attribution links"
else
    echo "   ❌ FAIL: Footer has <2 attribution links"
    exit 1
fi

TECH_TAGS=$(agent-browser eval 'document.querySelectorAll("footer .tech-tags span").length' 2>&1)
echo "   Tech tag count: $TECH_TAGS"
if [ "$TECH_TAGS" -ge 3 ]; then
    echo "   ✅ PASS: Footer has tech feature badges"
else
    echo "   ⚠️  WARN: Footer has <3 tech badges"
fi

# ─── Take a final screenshot ──────────────────────────────────────────────────
agent-browser screenshot --full "$SCREENSHOTS/03-all-elements-verified.png"

echo ""
echo "✅ TEST 03 PASSED — All UI elements verified"
agent-browser close
exit 0
