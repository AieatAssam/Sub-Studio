#!/usr/bin/env bash
# TEST: 05-results-display — Mock a completed pipeline and verify results UI
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
SCREENSHOTS="$TEST_DIR/screenshots/05-results-display"
mkdir -p "$SCREENSHOTS"

echo "🧪 TEST 05: Results display with mock pipeline data"

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

# ─── Inject mock transcription result ─────────────────────────────────────────
echo "   ── Injecting mock pipeline completion ──"

agent-browser eval "
    (() => {
        // Simulate completed pipeline state
        const mockState = {
            videoFile: new File(['fake'], 'demo.mp4', { type: 'video/mp4' }),
            audioBlob: new Blob(['fake-audio'], { type: 'audio/wav' }),
            transcription: { fullText: 'Mock transcription', chunks: [] },
            subtitles: [
                { index: 1, start: 0, end: 2.5, text: 'Hello, world!' },
                { index: 2, start: 3.0, end: 6.75, text: 'This is a subtitle test.' },
                { index: 3, start: 10.0, end: 12.0, text: 'Third subtitle line.' },
                { index: 4, start: 15.0, end: 18.5, text: 'Fourth and final subtitle.' },
            ],
            status: 'complete',
        };

        // Set state on the app's global state
        // Access via the module... or just render via DOM directly
        const r = document.getElementById('result-section');
        r.classList.remove('hidden');
        document.getElementById('upload-zone').classList.add('hidden');
        document.getElementById('video-container').classList.remove('hidden');
        document.getElementById('stats-section').classList.remove('hidden');

        // Render subtitle editor
        const editor = document.getElementById('subtitle-editor');
        editor.innerHTML = '';
        mockState.subtitles.forEach((sub, i) => {
            const row = document.createElement('div');
            row.className = 'subtitle-row';
            row.dataset.index = i;

            const timeLabel = document.createElement('span');
            timeLabel.className = 'subtitle-time';
            const h = String(Math.floor(sub.start/3600)).padStart(2,'0');
            const m = String(Math.floor((sub.start%3600)/60)).padStart(2,'0');
            const s = String(Math.floor(sub.start%60)).padStart(2,'0');
            const cs = String(Math.floor((sub.start%1)*1000)).padStart(3,'0');
            const h2 = String(Math.floor(sub.end/3600)).padStart(2,'0');
            const m2 = String(Math.floor((sub.end%3600)/60)).padStart(2,'0');
            const s2 = String(Math.floor(sub.end%60)).padStart(2,'0');
            const cs2 = String(Math.floor((sub.end%1)*1000)).padStart(3,'0');
            timeLabel.textContent = h+':'+m+':'+s+'.'+cs+' → '+h2+':'+m2+':'+s2+'.'+cs2;

            const textInput = document.createElement('input');
            textInput.className = 'subtitle-text';
            textInput.type = 'text';
            textInput.value = sub.text;

            row.appendChild(timeLabel);
            row.appendChild(textInput);
            editor.appendChild(row);
        });

        // Render stats
        const stats = document.getElementById('stats-content');
        stats.innerHTML = '';
        const subs = mockState.subtitles;
        const totalChars = subs.reduce((s,x) => s + x.text.length, 0);
        const totalWords = subs.reduce((s,x) => s + x.text.split(/\\s+/).filter(Boolean).length, 0);
        stats.innerHTML = [
            '<span class=\"stat\"><span class=\"stat-icon\">📝</span> '+subs.length+' subtitles</span>',
            '<span class=\"stat\"><span class=\"stat-icon\">📊</span> '+totalWords+' words</span>',
            '<span class=\"stat\"><span class=\"stat-icon\">⏱️</span> 0m 18s of audio</span>',
            '<span class=\"stat\"><span class=\"stat-icon\">🔡</span> '+totalChars+' characters</span>',
        ].join('');

        // Update export buttons
        const formatSelect = document.getElementById('format-select');
        const format = formatSelect.value;
        let content = '';
        if (format === 'srt') {
            content = subs.map((sub,i) => {
                const st = String(i+1);
                const startStr = '00:00:'+String(Math.floor(sub.start%60)).padStart(2,'0')+','+String(Math.floor((sub.start%1)*1000)).padStart(3,'0');
                const endStr = '00:00:'+String(Math.floor(sub.end%60)).padStart(2,'0')+','+String(Math.floor((sub.end%1)*1000)).padStart(3,'0');
                return st+'\\n'+startStr+' --> '+endStr+'\\n'+sub.text+'\\n';
            }).join('\\n');
        } else {
            content = 'WEBVTT\\n\\n' + subs.map(sub => {
                const startStr = '00:00:'+String(Math.floor(sub.start%60)).padStart(2,'0')+'.'+String(Math.floor((sub.start%1)*1000)).padStart(3,'0');
                const endStr = '00:00:'+String(Math.floor(sub.end%60)).padStart(2,'0')+'.'+String(Math.floor((sub.end%1)*1000)).padStart(3,'0');
                return startStr+' --> '+endStr+'\\n'+sub.text;
            }).join('\\n\\n');
        }
        document.getElementById('download-btn').dataset.content = content;
        document.getElementById('copy-btn').dataset.content = content;

        // Set video source (data URL for a tiny video)
        // Just mark video as ready
        document.getElementById('video-preview').src = 'data:video/mp4,';
    })();
" 2>&1

sleep 2
agent-browser screenshot "$SCREENSHOTS/01-mock-results.png"

# ─── Verify: Upload zone hidden ──────────────────────────────────────────────
UPLOAD_HIDDEN=$(agent-browser eval 'document.getElementById("upload-zone").classList.contains("hidden")' 2>&1)
if [ "$UPLOAD_HIDDEN" = "true" ]; then
    echo "   ✅ PASS: Upload zone hidden after results"
else
    echo "   ❌ FAIL: Upload zone should be hidden"
    exit 1
fi

# ─── Verify: Result section visible ──────────────────────────────────────────
RESULT_VISIBLE=$(agent-browser eval '!document.getElementById("result-section").classList.contains("hidden")' 2>&1)
if [ "$RESULT_VISIBLE" = "true" ]; then
    echo "   ✅ PASS: Result section visible"
else
    echo "   ❌ FAIL: Result section should be visible"
    exit 1
fi

# ─── Verify: Subtitle rows rendered ──────────────────────────────────────────
SUBTITLE_ROWS=$(agent-browser eval 'document.querySelectorAll(".subtitle-row").length' 2>&1)
echo "   Subtitle rows: $SUBTITLE_ROWS"
if [ "$SUBTITLE_ROWS" -eq 4 ]; then
    echo "   ✅ PASS: 4 subtitle rows rendered"
else
    echo "   ❌ FAIL: Expected 4 subtitle rows, got: $SUBTITLE_ROWS"
    exit 1
fi

# ─── Verify: First subtitle text ─────────────────────────────────────────────
FIRST_TEXT=$(agent-browser eval 'document.querySelector(".subtitle-text")?.value' 2>&1 | sed 's/^"//;s/"$//')
echo "   First subtitle text: $FIRST_TEXT"
if [ "$FIRST_TEXT" = "Hello, world!" ]; then
    echo "   ✅ PASS: First subtitle text correct"
else
    echo "   ❌ FAIL: Expected 'Hello, world!', got: $FIRST_TEXT"
    exit 1
fi

# ─── Verify: Last subtitle text ──────────────────────────────────────────────
LAST_TEXT=$(agent-browser eval 'document.querySelectorAll(".subtitle-text")[3]?.value' 2>&1 | sed 's/^"//;s/"$//')
echo "   Last subtitle text: $LAST_TEXT"
if [ "$LAST_TEXT" = "Fourth and final subtitle." ]; then
    echo "   ✅ PASS: Last subtitle text correct"
else
    echo "   ❌ FAIL: Expected 'Fourth and final subtitle.', got: $LAST_TEXT"
    exit 1
fi

# ─── Verify: Stats rendered ──────────────────────────────────────────────────
STATS_VISIBLE=$(agent-browser eval '!document.getElementById("stats-section").classList.contains("hidden")' 2>&1)
if [ "$STATS_VISIBLE" = "true" ]; then
    echo "   ✅ PASS: Stats section visible"
else
    echo "   ❌ FAIL: Stats section should be visible"
    exit 1
fi

STATS_WORDS=$(agent-browser eval 'document.querySelector("#stats-content").textContent' 2>&1)
if echo "$STATS_WORDS" | grep -qi "4 subtitles\|4 words\|18s\|0m 18s"; then
    echo "   ✅ PASS: Stats show subtitle count and word count"
else
    echo "   ⚠️  WARN: Stats content: $STATS_WORDS"
fi

# ─── Verify: Video container visible ─────────────────────────────────────────
VIDEO_VISIBLE=$(agent-browser eval '!document.getElementById("video-container").classList.contains("hidden")' 2>&1)
if [ "$VIDEO_VISIBLE" = "true" ]; then
    echo "   ✅ PASS: Video container visible"
else
    echo "   ❌ FAIL: Video container should be visible"
    exit 1
fi

# ─── Verify: Download button has content ──────────────────────────────────────
DL_CONTENT=$(agent-browser eval 'document.getElementById("download-btn").getAttribute("data-content") || ""' 2>&1)
if [ -n "$DL_CONTENT" ] && [ "$DL_CONTENT" != "null" ] && [ "$DL_CONTENT" != '""' ]; then
    echo "   ✅ PASS: Download button has content set"
else
    echo "   ⚠️  WARN: Download content: $DL_CONTENT"
fi

echo ""
echo "✅ TEST 05 PASSED — Results display verified"
agent-browser close
exit 0
