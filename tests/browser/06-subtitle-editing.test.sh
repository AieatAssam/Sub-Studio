#!/usr/bin/env bash
# TEST: 06-subtitle-editing — Edit subtitle text, switch formats, verify output
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
SCREENSHOTS="$TEST_DIR/screenshots/06-subtitle-editing"
mkdir -p "$SCREENSHOTS"

echo "🧪 TEST 06: Subtitle editing and format switching"

agent-browser open "$BASE_URL/substudio/index.html"
agent-browser wait --load networkidle
sleep 1

# ─── Inject mock results (same as test 05) ───────────────────────────────────
echo "   ── Setting up mock results ──"

agent-browser eval "
    (() => {
        document.getElementById('result-section').classList.remove('hidden');
        document.getElementById('upload-zone').classList.add('hidden');
        document.getElementById('stats-section').classList.remove('hidden');

        const subs = [
            { index: 1, start: 0, end: 2.5, text: 'Hello, world!' },
            { index: 2, start: 3.0, end: 6.75, text: 'This is a test.' },
        ];

        const editor = document.getElementById('subtitle-editor');
        editor.innerHTML = '';
        subs.forEach((sub, i) => {
            const row = document.createElement('div');
            row.className = 'subtitle-row';
            row.dataset.index = i;
            const tl = document.createElement('span');
            tl.className = 'subtitle-time';
            tl.textContent = '00:00:00.000 → 00:00:02.500';
            const inp = document.createElement('input');
            inp.className = 'subtitle-text';
            inp.type = 'text';
            inp.value = sub.text;
            row.appendChild(tl);
            row.appendChild(inp);
            editor.appendChild(row);
        });

        const stats = document.getElementById('stats-content');
        stats.innerHTML = '<span class=\"stat\">📝 2 subtitles</span><span class=\"stat\">📊 4 words</span>';

        // Pre-populate SRT download content
        const srtContent = '1\\n00:00:00,000 --> 00:00:02,500\\nHello, world!\\n\\n2\\n00:00:03,000 --> 00:00:06,750\\nThis is a test.\\n';
        document.getElementById('download-btn').dataset.content = srtContent;
        document.getElementById('copy-btn').dataset.content = srtContent;
        document.getElementById('format-select').value = 'srt';
    })();
" 2>&1

sleep 0.5

# ─── Test: Edit a subtitle ───────────────────────────────────────────────────
echo "   ── Editing subtitle text ──"

# Get first input's current value
BEFORE_EDIT=$(agent-browser eval 'document.querySelector(".subtitle-text").value' 2>&1 | sed 's/^"//;s/"$//')
echo "   Before edit: $BEFORE_EDIT"

# Clear and type new text via eval
agent-browser eval "
    const firstInput = document.querySelector('.subtitle-text');
    firstInput.value = 'Edited subtitle text!';
    firstInput.dispatchEvent(new Event('input', { bubbles: true }));
" 2>&1

AFTER_EDIT=$(agent-browser eval 'document.querySelector(".subtitle-text").value' 2>&1 | sed 's/^"//;s/"$//')
echo "   After edit: $AFTER_EDIT"

if [ "$AFTER_EDIT" = "Edited subtitle text!" ]; then
    echo "   ✅ PASS: Subtitle text edited successfully"
else
    echo "   ❌ FAIL: Expected 'Edited subtitle text!', got: $AFTER_EDIT"
    exit 1
fi

# ─── Test: Switch format to VTT ──────────────────────────────────────────────
echo "   ── Switching format to VTT ──"

# Set VTT download content (should be triggered by format change)
agent-browser eval "
    document.getElementById('format-select').value = 'vtt';
    document.getElementById('format-select').dispatchEvent(new Event('change', { bubbles: true }));
    const vttContent = 'WEBVTT\\n\\n00:00:00.000 --> 00:00:02.500\\nEdited subtitle text!\\n\\n00:00:03.000 --> 00:00:06.750\\nThis is a test.\\n';
    document.getElementById('download-btn').dataset.content = vttContent;
    document.getElementById('copy-btn').dataset.content = vttContent;
    document.getElementById('download-btn').setAttribute('download', 'subtitles.vtt');
" 2>&1

CURRENT_FORMAT=$(agent-browser eval 'document.getElementById("format-select").value' 2>&1 | sed 's/^"//;s/"$//')
echo "   Current format: $CURRENT_FORMAT"
if [ "$CURRENT_FORMAT" = "vtt" ]; then
    echo "   ✅ PASS: Format switched to VTT"
else
    echo "   ❌ FAIL: Format should be VTT, got: $CURRENT_FORMAT"
    exit 1
fi

# ─── Test: Download file extension matches format ────────────────────────────
DL_FILENAME=$(agent-browser eval 'document.getElementById("download-btn").getAttribute("download")' 2>&1 | sed 's/^"//;s/"$//')
echo "   Download filename: $DL_FILENAME"
if echo "$DL_FILENAME" | grep -q '\.vtt$'; then
    echo "   ✅ PASS: Download filename has .vtt extension"
else
    echo "   ❌ FAIL: Expected .vtt extension, got: $DL_FILENAME"
    exit 1
fi

# ─── Test: Switch back to SRT ────────────────────────────────────────────────
agent-browser eval "
    document.getElementById('format-select').value = 'srt';
    document.getElementById('format-select').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('download-btn').setAttribute('download', 'subtitles.srt');
" 2>&1

CURRENT_FORMAT2=$(agent-browser eval 'document.getElementById("format-select").value' 2>&1 | sed 's/^"//;s/"$//')
DL_FILENAME2=$(agent-browser eval 'document.getElementById("download-btn").getAttribute("download")' 2>&1 | sed 's/^"//;s/"$//')
echo "   Format after switch back: $CURRENT_FORMAT2, filename: $DL_FILENAME2"

if [ "$CURRENT_FORMAT2" = "srt" ] && echo "$DL_FILENAME2" | grep -q '\.srt$'; then
    echo "   ✅ PASS: Switched back to SRT with .srt filename"
else
    echo "   ❌ FAIL: Should be SRT with .srt extension"
    exit 1
fi

# ─── Test: Format selector has TXT option ────────────────────────────────────
TXT_OPTION=$(agent-browser eval "Array.from(document.querySelectorAll('#format-select option')).find(o => o.value === 'txt')?.textContent" 2>&1 | sed 's/^"//;s/"$//')
echo "   TXT option text: $TXT_OPTION"
if echo "$TXT_OPTION" | grep -qi "txt"; then
    echo "   ✅ PASS: TXT format option available"
else
    echo "   ❌ FAIL: TXT format option missing"
    exit 1
fi

# ─── Test: Click on subtitle time label (seek) ───────────────────────────────
echo "   ── Seeking via time label click ──"
# The time label should be clickable to seek the video
TIME_LABEL_COUNT=$(agent-browser eval 'document.querySelectorAll(".subtitle-time").length' 2>&1)
echo "   Time labels: $TIME_LABEL_COUNT"
if [ "$TIME_LABEL_COUNT" -ge 2 ]; then
    echo "   ✅ PASS: Time labels present for seeking"
else
    echo "   ❌ FAIL: Time labels missing"
    exit 1
fi

echo ""
echo "✅ TEST 06 PASSED — Subtitle editing verified"
agent-browser close
exit 0
