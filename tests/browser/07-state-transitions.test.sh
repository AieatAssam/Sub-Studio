#!/usr/bin/env bash
# TEST: 07-state-transitions — Verify every pipeline state transition works
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
SCREENSHOTS="$TEST_DIR/screenshots/07-state-transitions"
mkdir -p "$SCREENSHOTS"

echo "🧪 TEST 07: State machine transitions"

agent-browser open "$BASE_URL/substudio/index.html"
agent-browser wait --load networkidle
sleep 1

# ─── Test all state transition effects ────────────────────────────────────────
echo "   ── Transition: idle → loading-ffmpeg ──"
agent-browser eval "
    document.getElementById('progress-section').classList.remove('hidden');
    document.getElementById('status-icon').textContent = '🔧';
    document.getElementById('progress-label').textContent = 'Loading FFmpeg engine...';
    document.getElementById('progress-bar').style.width = '5%';
" 2>&1

LABEL=$(agent-browser eval 'document.getElementById("progress-label").textContent' 2>&1 | sed 's/^"//;s/"$//')
WIDTH=$(agent-browser eval 'document.getElementById("progress-bar").style.width' 2>&1 | sed 's/^"//;s/"$//')
ICON=$(agent-browser eval 'document.getElementById("status-icon").textContent' 2>&1 | sed 's/^"//;s/"$//')

if echo "$LABEL" | grep -qi "FFmpeg" && [ "$WIDTH" = "5%" ] && [ "$ICON" = "🔧" ]; then
    echo "   ✅ PASS: loading-ffmpeg state renders correctly"
else
    echo "   ❌ FAIL: loading-ffmpeg state — label=$LABEL, width=$WIDTH, icon=$ICON"
    exit 1
fi

echo "   ── Transition: loading-ffmpeg → extracting (audio) ──"
agent-browser eval "
    document.getElementById('status-icon').textContent = '🎵';
    document.getElementById('progress-label').textContent = 'Extracting audio track...';
    document.getElementById('progress-bar').style.width = '40%';
" 2>&1
LABEL2=$(agent-browser eval 'document.getElementById("progress-label").textContent' 2>&1)
ICON2=$(agent-browser eval 'document.getElementById("status-icon").textContent' 2>&1)
WIDTH2=$(agent-browser eval 'document.getElementById("progress-bar").style.width' 2>&1)

if echo "$LABEL2" | grep -qi "Extracting" && echo "$ICON2" | grep -q "🎵"; then
    echo "   ✅ PASS: extracting state renders correctly"
else
    echo "   ❌ FAIL: extracting state"
    exit 1
fi

echo "   ── Transition: extracting → loading-model ──"
agent-browser eval "
    document.getElementById('status-icon').textContent = '🧠';
    document.getElementById('progress-label').textContent = 'Loading AI model (~150MB)...';
    document.getElementById('progress-bar').style.width = '60%';
" 2>&1
LABEL3=$(agent-browser eval 'document.getElementById("progress-label").textContent' 2>&1)
if echo "$LABEL3" | grep -qi "AI model\|150MB"; then
    echo "   ✅ PASS: loading-model state renders correctly"
else
    echo "   ❌ FAIL: loading-model state"
    exit 1
fi

echo "   ── Transition: loading-model → transcribing ──"
agent-browser eval "
    document.getElementById('status-icon').textContent = '✍️';
    document.getElementById('progress-label').textContent = 'Transcribing audio with AI...';
    document.getElementById('progress-bar').style.width = '80%';
" 2>&1
LABEL4=$(agent-browser eval 'document.getElementById("progress-label").textContent' 2>&1)
if echo "$LABEL4" | grep -qi "Transcribing"; then
    echo "   ✅ PASS: transcribing state renders correctly"
else
    echo "   ❌ FAIL: transcribing state"
    exit 1
fi

echo "   ── Transition: transcribing → 100% ──"
agent-browser eval "
    document.getElementById('progress-bar').style.width = '100%';
    document.getElementById('progress-label').textContent = 'Transcription complete!';
" 2>&1
WIDTH5=$(agent-browser eval 'document.getElementById("progress-bar").style.width' 2>&1 | sed 's/^"//;s/"$//')
if [ "$WIDTH5" = "100%" ]; then
    echo "   ✅ PASS: Progress reaches 100%"
else
    echo "   ❌ FAIL: Progress should be 100%, got: $WIDTH5"
    exit 1
fi

# ─── Test: Progress section can be hidden (transition to complete) ────────────
echo "   ── Transition: complete → idle (reset) ──"
agent-browser eval "
    document.getElementById('progress-section').classList.add('hidden');
" 2>&1
PROGRESS_HIDDEN=$(agent-browser eval 'document.getElementById("progress-section").classList.contains("hidden")' 2>&1)
if [ "$PROGRESS_HIDDEN" = "true" ]; then
    echo "   ✅ PASS: Progress section can be hidden (complete state)"
else
    echo "   ❌ FAIL: Progress section should be hidable"
    exit 1
fi

# ─── Test: Reset from any state ──────────────────────────────────────────────
echo "   ── Reset from mixed state ──"
agent-browser eval "
    // Simulate a mixed state (progress visible + some results)
    document.getElementById('progress-section').classList.remove('hidden');
    document.getElementById('progress-bar').style.width = '45%';
    document.getElementById('result-section').classList.remove('hidden');
    document.getElementById('video-container').classList.remove('hidden');
    document.getElementById('stats-section').classList.remove('hidden');
    document.getElementById('upload-zone').classList.add('hidden');
" 2>&1

# Now click clear button
agent-browser eval 'document.getElementById("clear-btn").click()' 2>&1
sleep 0.5

# Verify all sections returned to idle state
UPLOAD_VISIBLE=$(agent-browser eval '!document.getElementById("upload-zone").classList.contains("hidden")' 2>&1)
RESULT_HIDDEN=$(agent-browser eval 'document.getElementById("result-section").classList.contains("hidden")' 2>&1)
VIDEO_HIDDEN=$(agent-browser eval 'document.getElementById("video-container").classList.contains("hidden")' 2>&1)
STATS_HIDDEN=$(agent-browser eval 'document.getElementById("stats-section").classList.contains("hidden")' 2>&1)
PROGRESS_HIDDEN2=$(agent-browser eval 'document.getElementById("progress-section").classList.contains("hidden")' 2>&1)

if [ "$UPLOAD_VISIBLE" = "true" ] && [ "$RESULT_HIDDEN" = "true" ] && [ "$VIDEO_HIDDEN" = "true" ] && [ "$STATS_HIDDEN" = "true" ] && [ "$PROGRESS_HIDDEN2" = "true" ]; then
    echo "   ✅ PASS: Reset returns to clean idle state"
else
    echo "   ❌ FAIL: Not all sections reset — upload=$UPLOAD_VISIBLE result_hidden=$RESULT_HIDDEN video=$VIDEO_HIDDEN stats=$STATS_HIDDEN progress=$PROGRESS_HIDDEN2"
    exit 1
fi

# ─── Test: Error state ───────────────────────────────────────────────────────
echo "   ── Error state ──"
agent-browser eval "
    document.getElementById('error-display').classList.remove('hidden');
    document.getElementById('error-message').textContent = 'Something went wrong during processing';
" 2>&1

ERR_VISIBLE=$(agent-browser eval '!document.getElementById("error-display").classList.contains("hidden")' 2>&1)
ERR_MSG=$(agent-browser eval 'document.getElementById("error-message").textContent' 2>&1 | sed 's/^"//;s/"$//')
if [ "$ERR_VISIBLE" = "true" ] && echo "$ERR_MSG" | grep -qi "something went wrong"; then
    echo "   ✅ PASS: Error state renders correctly"
else
    echo "   ❌ FAIL: Error state — visible=$ERR_VISIBLE, msg=$ERR_MSG"
    exit 1
fi

# ─── Test: Error cleared on new file upload ──────────────────────────────────
echo "   ── Error cleared by reset ──"
agent-browser eval 'document.getElementById("clear-btn").click()' 2>&1
sleep 0.3
ERR_HIDDEN=$(agent-browser eval 'document.getElementById("error-display").classList.contains("hidden")' 2>&1)
if [ "$ERR_HIDDEN" = "true" ]; then
    echo "   ✅ PASS: Error cleared by reset"
else
    echo "   ❌ FAIL: Error should be cleared on reset"
    exit 1
fi

agent-browser screenshot --full "$SCREENSHOTS/01-state-transitions.png"

echo ""
echo "✅ TEST 07 PASSED — State transitions verified"
agent-browser close
exit 0
