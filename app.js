/* SubStudio - Browser-based AI Subtitle Generator
 * All processing is local. No uploads, no API keys, no backend.
 *
 * Pipeline:
 *   1. User drops/selects video file
 *   2. FFmpeg.wasm extracts 16kHz mono WAV audio
 *   3. Transformers.js Whisper transcribes with timestamps
 *   4. SRT/VTT generated from transcription segments
 *   5. User previews, edits, and exports subtitles
 */

// ─── Imports (loaded dynamically from CDN) ───────────────────────────────────

import {
    formatTime, formatTimeVTT,
    generateSRT, generateVTT, generateTXT, generatePreview,
    isValidVideoFile, isAudioFile, isFileSizeValid,
    parseWhisperChunks, estimateDurationFromWav
} from './subtitle-utils.js';

let pipeline;
async function loadTransformers() {
    if (pipeline) return;
    const mod = await import('https://esm.sh/@xenova/transformers@2.17.2');
    pipeline = mod.pipeline;
}

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
    videoFile: null,
    audioBlob: null,
    transcription: null,
    subtitles: null,  // Array of {index, start, end, text}
    currentTime: 0,
    status: 'idle',   // idle | extracting | loading-model | transcribing | complete | error
    errorMessage: '',
    progress: 0,
    progressLabel: '',
    selectedFormat: 'srt',
};

// ─── DOM References ──────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const dom = {
    uploadZone: $('upload-zone'),
    fileInput: $('file-input'),
    uploadOverlay: $('upload-overlay'),
    videoPreview: $('video-preview'),
    subtitleTrack: $('subtitle-track'),
    currentSubtitle: $('current-subtitle'),
    progressSection: $('progress-section'),
    progressBar: $('progress-bar'),
    progressLabel: $('progress-label'),
    statusIcon: $('status-icon'),
    resultSection: $('result-section'),
    subtitleEditor: $('subtitle-editor'),
    formatSelect: $('format-select'),
    copyBtn: $('copy-btn'),
    downloadBtn: $('download-btn'),
    editorToggle: $('editor-toggle'),
    videoContainer: $('video-container'),
    dropText: $('drop-text'),
    errorDisplay: $('error-display'),
    errorMessage: $('error-message'),
    clearBtn: $('clear-btn'),
    statsSection: $('stats-section'),
    statsContent: $('stats-content'),

    // URL & sample
    urlSection: $('url-section'),
    urlInput: $('url-input'),
    urlLoadBtn: $('url-load-btn'),
    sampleBtn: $('sample-btn'),
    sampleUrlLink: $('sample-url-link'),
    urlLoading: $('url-loading'),
    urlLoadingText: $('url-loading-text'),
};

// ─── UI Helpers ──────────────────────────────────────────────────────────────

function setStatus(status, progress = 0, label = '') {
    state.status = status;
    state.progress = progress;
    state.progressLabel = label;
    renderStatus();
}

function renderStatus() {
    const s = state.status;
    dom.progressSection.classList.toggle('hidden', s === 'idle' || s === 'complete' || s === 'error');

    if (s === 'idle' || s === 'complete' || s === 'error') return;

    dom.progressBar.style.width = `${state.progress}%`;
    dom.progressLabel.textContent = state.progressLabel;

    // Update status icon based on current operation
    const icons = {
        'extracting': '🎵',
        'extracting': '🎵',
        'loading-model': '🧠',
        'transcribing': '✍️',
    };
    dom.statusIcon.textContent = icons[s] || '⏳';
}

function showError(message) {
    state.status = 'error';
    state.errorMessage = message;
    dom.errorDisplay.classList.remove('hidden');
    dom.errorMessage.textContent = message;
    dom.progressSection.classList.add('hidden');
}

function hideError() {
    dom.errorDisplay.classList.add('hidden');
}

// ─── Subtitle Format Generators ──────────────────────────────────────────────
// (imported from subtitle-utils.js)

// ─── Pipeline: Audio Extraction (Web Audio API) ──────────────────────────────
// Extracts 16kHz mono PCM audio from video files using the browser's native
// decoders. No FFmpeg.wasm or SharedArrayBuffer needed.

// AudioContext helper — creates a context in the correct state for mobile
async function createActiveAudioContext() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // On mobile Chrome, AudioContext starts suspended and needs user gesture.
    // Since the user triggered this (click/drop), resume() should work.
    if (ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch (resumeErr) {
            console.warn('AudioContext resume failed:', resumeErr);
        }
    }
    return ctx;
}

async function extractAudio(videoFile, onProgress) {
    onProgress(10, 'Decoding audio via browser...');

    const arrayBuffer = await videoFile.arrayBuffer();
    const audioCtx = await createActiveAudioContext();

    let audioBuffer;

    // Strategy 1: decodeAudioData on the full file (works for most formats
    // on desktop, limited on mobile where video container decode may fail)
    try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
        // Verify we got actual audio (non-zero length)
        if (!audioBuffer || audioBuffer.length === 0) {
            throw new Error('Decoded audio buffer is empty');
        }
    } catch (decodeErr) {
        console.warn('decodeAudioData failed, trying MediaRecorder fallback:', decodeErr.message);
        onProgress(30, 'Playing video to capture audio...');
        // Strategy 2: play video through a <video> element and capture via MediaRecorder
        try {
            audioBuffer = await captureAudioFromVideo(videoFile, onProgress);
        } catch (captureErr) {
            console.error('MediaRecorder fallback also failed:', captureErr);
            // Strategy 3: last resort — try decodeAudioData on just the audio
            // portion (some mobile browsers handle audio-only files but not video)
            throw new Error('Could not extract audio from this video on this browser. '
                + 'Try the sample button to test with generated audio, '
                + 'or use a different browser (Chrome desktop recommended).');
        }
    }

    onProgress(70, 'Resampling to 16kHz...');

    // Get raw PCM data (mono mix)
    const numChannels = audioBuffer.numberOfChannels;
    const originalRate = audioBuffer.sampleRate;
    const originalLength = audioBuffer.length;
    const duration = originalLength / originalRate;

    // Mix down to mono if needed
    let monoData;
    if (numChannels === 1) {
        monoData = audioBuffer.getChannelData(0);
    } else {
        monoData = new Float32Array(originalLength);
        for (let ch = 0; ch < numChannels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            for (let i = 0; i < originalLength; i++) {
                monoData[i] += channelData[i] / numChannels;
            }
        }
    }

    // Resample to 16kHz using linear interpolation
    const targetRate = 16000;
    const targetLength = Math.floor(duration * targetRate);
    const resampled = new Float32Array(targetLength);
    const ratio = originalLength / targetLength;
    for (let i = 0; i < targetLength; i++) {
        const srcIdx = i * ratio;
        const idx1 = Math.floor(srcIdx);
        const idx2 = Math.min(idx1 + 1, originalLength - 1);
        const frac = srcIdx - idx1;
        resampled[i] = monoData[idx1] * (1 - frac) + monoData[idx2] * frac;
    }

    onProgress(100, 'Audio extracted!');

    await audioCtx.close();

    return {
        samples: resampled,
        sampleRate: targetRate,
    };
}

// Fallback: capture audio from a video element using MediaRecorder
async function captureAudioFromVideo(videoFile, onProgress) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.muted = true;   // Mute to avoid speaker feedback
        video.playsInline = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous';

        const chunks = [];
        let timeoutId;
        let cleanup = () => {
            clearTimeout(timeoutId);
            video.remove();
            URL.revokeObjectURL(video.src);
        };

        video.onloadedmetadata = async () => {
            const duration = video.duration;
            if (!duration || !isFinite(duration) || duration <= 0) {
                cleanup();
                reject(new Error('Could not determine video duration'));
                return;
            }

            onProgress(40, 'Video loaded, capturing audio...');

            try {
                const audioCtx = await createActiveAudioContext();

                // Some mobile browsers don't support createMediaElementSource
                if (!audioCtx.createMediaElementSource) {
                    cleanup();
                    audioCtx.close();
                    reject(new Error('createMediaElementSource not available on this browser'));
                    return;
                }

                const source = audioCtx.createMediaElementSource(video);
                const dest = audioCtx.createMediaStreamDestination();
                source.connect(dest);

                // Pick audio format supported by the browser
                let mimeType = 'audio/webm';
                if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                    mimeType = 'audio/webm;codecs=opus';
                } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                    mimeType = 'audio/mp4';
                }

                const recorder = new MediaRecorder(dest.stream, { mimeType });

                recorder.ondataavailable = (e) => {
                    if (e.data.size > 0) chunks.push(e.data);
                };

                recorder.onstop = async () => {
                    clearTimeout(timeoutId);
                    const recorded = new Blob(chunks, { type: mimeType });

                    if (chunks.length === 0) {
                        cleanup();
                        audioCtx.close();
                        reject(new Error('No audio data captured — video may have no audio track'));
                        return;
                    }

                    onProgress(60, 'Decoding captured audio...');
                    try {
                        const buf = await recorded.arrayBuffer();
                        // Ensure context is active before decode
                        if (audioCtx.state === 'suspended') await audioCtx.resume();
                        const decoded = await audioCtx.decodeAudioData(buf);
                        cleanup();
                        audioCtx.close();
                        resolve(decoded);
                    } catch (decodeErr) {
                        cleanup();
                        audioCtx.close();
                        reject(new Error('Could not decode captured audio: ' + decodeErr.message));
                    }
                };

                recorder.onerror = () => {
                    cleanup();
                    reject(new Error('MediaRecorder error during capture'));
                };

                recorder.start(1000); // Collect data every second
                video.play().catch((playErr) => {
                    cleanup();
                    reject(new Error('Could not play video for capture: ' + playErr.message));
                });

                // Safety timeout: video duration + 30s buffer
                timeoutId = setTimeout(() => {
                    if (recorder.state === 'recording') {
                        recorder.stop();
                    }
                }, (duration + 30) * 1000);

                video.onended = () => {
                    if (recorder.state === 'recording') {
                        recorder.stop();
                    }
                };

            } catch (err) {
                cleanup();
                reject(new Error('Capture setup failed: ' + err.message));
            }
        };

        video.onerror = (e) => {
            const mediaError = video.error;
            const msg = mediaError
                ? `Code ${mediaError.code}: ${mediaError.message}`
                : 'Could not load video for audio capture';
            reject(new Error(msg));
        };

        video.src = URL.createObjectURL(videoFile);
    });
}

// ─── Pipeline: AI Transcription ──────────────────────────────────────────────

// Timeout a promise after `ms` milliseconds with a custom error
function withTimeout(promise, ms, timeoutMsg) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMsg)), ms);
    });
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        timeout,
    ]);
}

async function transcribeAudio(audioData, onProgress) {
    onProgress(5, 'Loading AI model (Whisper tiny)...');
    setStatus('loading-model', 5, 'Downloading AI model (~40MB, cached after first use)...');

    await loadTransformers();

    onProgress(30, 'Initializing transcription pipeline...');

    let pipe;
    try {
        // Wrap model loading in a 90-second timeout (model is ~40MB over network)
        pipe = await withTimeout(
            pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
                progress_callback: (progress) => {
                    if (progress.status === 'progress' && progress.file) {
                        const percent = 30 + Math.round(progress.progress * 40);
                        setStatus('loading-model', percent, `Loading ${progress.file}...`);
                    }
                },
            }),
            90000,
            'AI model download timed out. '
            + 'On mobile, ensure you have a stable connection. '
            + 'Check your network and try again.'
        );
    } catch (loadErr) {
        // Distinguish network failure from model format errors
        if (loadErr.message?.includes('Unsupported model')) {
            throw new Error('This browser does not support the Whisper AI model format. '
                + 'Try Google Chrome on a desktop computer.');
        }
        throw loadErr;
    }

    setStatus('transcribing', 30, 'Transcribing audio with AI...');

    // Show incremental progress during transcription
    let fakeProgress = 30;
    const progressInterval = setInterval(() => {
        fakeProgress = Math.min(90, fakeProgress + 2);
        setStatus('transcribing', fakeProgress, `Processing audio...`);
    }, 1000);

    try {
        const result = await pipe(audioData.samples, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: true,
        });

        clearInterval(progressInterval);
        setStatus('transcribing', 100, 'Transcription complete!');

        let subtitles = parseWhisperChunks(result.chunks);

        if (subtitles.length === 0 && result.text) {
            subtitles = [{
                index: 1,
                start: 0,
                end: 0,
                text: result.text.trim(),
            }];
        }

        return {
            fullText: result.text,
            chunks: result.chunks,
            subtitles,
        };
    } catch (err) {
        clearInterval(progressInterval);
        throw err;
    }
}

// ─── Estimate Audio Duration ─────────────────────────────────────────────────

async function estimateAudioDuration(blob) {
    return new Promise((resolve) => {
        const audio = new Audio();
        audio.onloadedmetadata = () => {
            resolve(audio.duration);
            URL.revokeObjectURL(audio.src);
        };
        audio.onerror = () => {
            // Fallback: estimate from WAV header
            blob.arrayBuffer().then(buf => {
                const duration = estimateDurationFromWav(buf);
                resolve(Math.round(duration) || 0);
            }).catch(() => resolve(0));
        };
        audio.src = URL.createObjectURL(blob);
    });
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

async function runPipeline(videoFile) {
    hideError();
    state.videoFile = videoFile;

    try {
        // Step 1: Extract audio
        setStatus('extracting', 0, 'Decoding video audio...');
        const audioData = await extractAudio(videoFile, (pct, label) => {
            setStatus('extracting', pct, label);
        });

        state.audioBlob = audioData;

        // Step 2: Transcribe
        const result = await transcribeAudio(audioData, (pct, label) => {
            setStatus('transcribing', pct, label);
        });

        state.transcription = result;
        state.subtitles = result.subtitles;

        // If no timestamps (single segment without timing), estimate
        if (state.subtitles.length === 1 && state.subtitles[0].end === 0) {
            // Estimate from sample count
            const duration = audioData.samples.length / audioData.sampleRate;
            if (duration > 0) {
                state.subtitles[0].end = Math.round(duration);
            }
        }

        // Step 3: Show results
        state.status = 'complete';
        renderResults();
        renderVideoSubtitles();

    } catch (err) {
        console.error('Pipeline error:', err);
        showError(`Something went wrong: ${err.message || 'Unknown error'}`);
    }
}

// ─── Results Rendering ───────────────────────────────────────────────────────

function renderResults() {
    dom.resultSection.classList.remove('hidden');
    dom.uploadZone.classList.add('hidden');
    dom.videoContainer.classList.remove('hidden');
    dom.statsSection.classList.remove('hidden');

    // Populate subtitle editor
    renderSubtitleEditor();
    renderStats();

    // Set video source
    const videoURL = URL.createObjectURL(state.videoFile);
    dom.videoPreview.src = videoURL;

    // Set subtitle track
    const vttBlob = new Blob([generateVTT(state.subtitles)], { type: 'text/vtt' });
    const vttURL = URL.createObjectURL(vttBlob);
    dom.subtitleTrack.src = vttURL;

    // Show copy/download buttons
    updateExportButtons();
}

function renderSubtitleEditor() {
    dom.subtitleEditor.innerHTML = '';
    state.subtitles.forEach((sub, i) => {
        const row = document.createElement('div');
        row.className = 'subtitle-row';
        row.dataset.index = i;

        const timeLabel = document.createElement('span');
        timeLabel.className = 'subtitle-time';
        timeLabel.textContent = `${formatTimeVTT(sub.start)} → ${formatTimeVTT(sub.end)}`;
        timeLabel.title = 'Click to seek to this time';
        timeLabel.addEventListener('click', () => {
            dom.videoPreview.currentTime = sub.start;
            dom.videoPreview.play();
        });

        const textInput = document.createElement('input');
        textInput.className = 'subtitle-text';
        textInput.type = 'text';
        textInput.value = sub.text;
        textInput.addEventListener('input', () => {
            state.subtitles[i].text = textInput.value;
            updateExportButtons();
        });

        row.appendChild(timeLabel);
        row.appendChild(textInput);
        dom.subtitleEditor.appendChild(row);
    });
}

function renderStats() {
    const subs = state.subtitles;
    const totalChars = subs.reduce((sum, s) => sum + s.text.length, 0);
    const totalWords = subs.reduce((sum, s) => sum + s.text.split(/\s+/).filter(Boolean).length, 0);
    const duration = subs.length > 0 ? subs[subs.length - 1].end : 0;
    const mins = Math.floor(duration / 60);
    const secs = Math.floor(duration % 60);

    dom.statsContent.innerHTML = `
        <span class="stat"><span class="stat-icon">📝</span> ${subs.length} subtitles</span>
        <span class="stat"><span class="stat-icon">📊</span> ${totalWords} words</span>
        <span class="stat"><span class="stat-icon">⏱️</span> ${mins}m ${secs}s of audio</span>
        <span class="stat"><span class="stat-icon">🔡</span> ${totalChars} characters</span>
    `;
}

function updateExportButtons() {
    const format = state.selectedFormat || dom.formatSelect.value;
    let content;
    switch (format) {
        case 'srt': content = generateSRT(state.subtitles); break;
        case 'vtt': content = generateVTT(state.subtitles); break;
        case 'txt': content = generateTXT(state.subtitles); break;
        default: content = generateSRT(state.subtitles);
    }

    // Update download href
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    dom.downloadBtn.href = url;
    dom.downloadBtn.download = `subtitles.${format}`;

    // Copy button copies content
    dom.copyBtn.dataset.content = content;
}

function renderVideoSubtitles() {
    // We use a <track> element for proper in-video subtitles
    // This is handled by setting the track.src above
}

// ─── Current Subtitle Overlay ────────────────────────────────────────────────

function updateCurrentSubtitle(time) {
    if (!state.subtitles) {
        dom.currentSubtitle.textContent = '';
        return;
    }

    const active = state.subtitles.find(s => time >= s.start && time <= s.end);
    dom.currentSubtitle.textContent = active ? active.text : '';
}

// ─── UI Event Handlers ───────────────────────────────────────────────────────

// File input
dom.fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
});

// Drag and drop
let dragCounter = 0;

dom.uploadZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dom.uploadZone.classList.add('drag-over');
    dom.dropText.textContent = '📂 Drop your video here!';
});

dom.uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
        dom.uploadZone.classList.remove('drag-over');
        dom.dropText.textContent = '📁 Drop a video file here or click to browse';
    }
});

dom.uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
});

dom.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dom.uploadZone.classList.remove('drag-over');
    dom.dropText.textContent = '📁 Drop a video file here or click to browse';

    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
});

// Click to upload
dom.uploadZone.addEventListener('click', () => {
    dom.fileInput.click();
});

// Video time update
dom.videoPreview.addEventListener('timeupdate', () => {
    updateCurrentSubtitle(dom.videoPreview.currentTime);
});

// Format selector
dom.formatSelect.addEventListener('change', () => {
    state.selectedFormat = dom.formatSelect.value;
    updateExportButtons();
});

// Copy button
dom.copyBtn.addEventListener('click', async () => {
    const content = dom.copyBtn.dataset.content;
    if (!content) return;
    try {
        await navigator.clipboard.writeText(content);
        const original = dom.copyBtn.textContent;
        dom.copyBtn.textContent = '✅ Copied!';
        setTimeout(() => { dom.copyBtn.textContent = original; }, 2000);
    } catch {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = content;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const original = dom.copyBtn.textContent;
        dom.copyBtn.textContent = '✅ Copied!';
        setTimeout(() => { dom.copyBtn.textContent = original; }, 2000);
    }
});

// Clear / start over
dom.clearBtn.addEventListener('click', () => {
    resetAll();
});

// Video ended - reset current subtitle
dom.videoPreview.addEventListener('ended', () => {
    dom.currentSubtitle.textContent = '';
});

// ─── URL Loading ────────────────────────────────────────────────────────────

async function handleUrl(url) {
    hideError();
    const trimmed = url.trim();
    if (!trimmed) {
        showError('Please enter a video URL');
        return;
    }

    // Show loading indicator
    dom.urlLoading.classList.remove('hidden');
    dom.urlLoadingText.textContent = 'Downloading video...';
    dom.urlLoadBtn.disabled = true;

    try {
        const response = await fetch(trimmed, { mode: 'cors' });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const contentLength = response.headers.get('content-length');

        // Check content type roughly
        const isVideo = contentType.startsWith('video/') || !contentType;
        if (!isVideo && contentType && !contentType.startsWith('application/octet-stream')) {
            console.warn(`Unexpected content-type: ${contentType} — proceeding anyway`);
        }

        // Size check from Content-Length header
        if (contentLength) {
            const size = parseInt(contentLength, 10);
            if (!isFileSizeValid(size)) {
                throw new Error('File is too large (max 2GB)');
            }
        }

        dom.urlLoadingText.textContent = `Downloading (${contentLength ? Math.round(parseInt(contentLength) / 1024 / 1024) + 'MB' : 'large file'})...`;

        const blob = await response.blob();
        dom.urlLoading.classList.add('hidden');
        dom.urlLoadBtn.disabled = false;

        // Derive filename from URL
        const urlPath = new URL(trimmed).pathname;
        const filename = urlPath.split('/').pop() || 'video.mp4';
        const file = new File([blob], filename, { type: blob.type || 'video/mp4' });

        dom.dropText.textContent = `🌐 ${filename}`;
        runPipeline(file);

    } catch (err) {
        dom.urlLoading.classList.add('hidden');
        dom.urlLoadBtn.disabled = false;

        if (err.name === 'TypeError' && err.message.includes('fetch')) {
            showError('CORS blocked the request. The server at this URL does not allow cross-origin access. Download the file and upload it instead, or use the sample button above.');
        } else if (err.message.includes('NetworkError') || err.message.includes('Failed to fetch')) {
            showError('Network error. Check the URL is correct and the server is reachable. Try the sample button instead.');
        } else {
            showError(`Could not load video from URL: ${err.message}`);
        }
    }
}

// ─── Sample Video Generation ─────────────────────────────────────────────────

async function generateSampleAudio() {
    hideError();
    dom.dropText.textContent = '🎵 Generating sample audio...';

    try {
        const sampleRate = 16000;
        const duration = 6;
        const length = sampleRate * duration;
        const offlineCtx = new OfflineAudioContext(1, length, sampleRate);

        // Generate a tone sequence that sounds speech-like
        // The tones create distinct formants at different frequencies
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        const now = offlineCtx.currentTime;

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);       // Baseline (vowel-like)
        osc.frequency.linearRampToValueAtTime(280, now + 0.5);
        osc.frequency.linearRampToValueAtTime(200, now + 1.0);
        osc.frequency.linearRampToValueAtTime(350, now + 1.5);
        osc.frequency.linearRampToValueAtTime(250, now + 2.0);
        osc.frequency.linearRampToValueAtTime(400, now + 2.5);
        osc.frequency.linearRampToValueAtTime(300, now + 3.0);
        osc.frequency.linearRampToValueAtTime(500, now + 3.5);
        osc.frequency.linearRampToValueAtTime(220, now + 4.0);
        osc.frequency.linearRampToValueAtTime(380, now + 4.5);
        osc.frequency.linearRampToValueAtTime(450, now + 5.0);
        osc.frequency.linearRampToValueAtTime(200, now + 5.5);

        // Envelope: gentle attack/decay on each syllable
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.4, now + 0.05);
        gain.gain.setValueAtTime(0.35, now + 0.4);
        gain.gain.linearRampToValueAtTime(0, now + 0.55);
        gain.gain.setValueAtTime(0.4, now + 0.7);
        gain.gain.linearRampToValueAtTime(0, now + 0.9);
        gain.gain.setValueAtTime(0.35, now + 1.1);
        gain.gain.linearRampToValueAtTime(0, now + 1.3);
        gain.gain.setValueAtTime(0.4, now + 1.5);
        gain.gain.linearRampToValueAtTime(0, now + 1.7);
        // ... continue pulsations for 6 seconds
        for (let t = 1.8; t < duration; t += 0.55) {
            gain.gain.setValueAtTime(0.35, now + t);
            gain.gain.linearRampToValueAtTime(0, now + t + 0.25);
        }

        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(now);
        osc.stop(now + duration);

        const renderedBuffer = await offlineCtx.startRendering();
        const audioData = renderedBuffer.getChannelData(0);

        // Encode as WAV
        const wavBuffer = encodeWav(audioData, sampleRate);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });

        const filename = 'sample-audio.wav';
        const file = new File([blob], filename, { type: 'audio/wav' });

        dom.dropText.textContent = '🎵 Sample audio generated (6s)';
        runPipeline(file);

    } catch (err) {
        console.error('Sample generation error:', err);
        showError(`Could not generate sample audio: ${err.message}. Try uploading a file instead.`);
    }
}

function encodeWav(samples, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = samples.length * (bitsPerSample / 8);
    const bufferSize = 44 + dataSize;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write samples (16-bit PCM)
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    return buffer;
}

function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

// ─── File Validation ─────────────────────────────────────────────────────────

function handleFile(file) {
    hideError();

    const isVideo = isValidVideoFile(file);

    if (!isVideo && !isAudioFile(file)) {
        showError('Please select a video file (MP4, WebM, MOV, AVI, MKV, etc.)');
        return;
    }

    // File size check (2GB max - browser memory limit)
    if (!isFileSizeValid(file.size)) {
        showError('File is too large. Maximum size is 2GB.');
        return;
    }

    // Show filename
    dom.dropText.textContent = `🎬 ${file.name}`;

    // Start the pipeline
    runPipeline(file);
}

// ─── Reset ───────────────────────────────────────────────────────────────────

function resetAll() {
    state.videoFile = null;
    state.audioBlob = null;
    state.transcription = null;
    state.subtitles = null;
    state.status = 'idle';
    state.errorMessage = '';
    state.progress = 0;

    // Clean up video URL
    if (dom.videoPreview.src) {
        URL.revokeObjectURL(dom.videoPreview.src);
        dom.videoPreview.src = '';
    }
    if (dom.subtitleTrack.src) {
        URL.revokeObjectURL(dom.subtitleTrack.src);
        dom.subtitleTrack.src = '';
    }

    dom.uploadZone.classList.remove('hidden');
    dom.resultSection.classList.add('hidden');
    dom.videoContainer.classList.add('hidden');
    dom.progressSection.classList.add('hidden');
    dom.errorDisplay.classList.add('hidden');
    dom.statsSection.classList.add('hidden');
    dom.urlSection.classList.remove('hidden');
    dom.dropText.textContent = '📁 Drop a video file here or click to browse';
    dom.currentSubtitle.textContent = '';
    dom.subtitleEditor.innerHTML = '';
    dom.fileInput.value = '';
    dom.urlInput.value = '';
    dom.urlLoading.classList.add('hidden');
    dom.urlLoadBtn.disabled = false;
    dom.urlSection.classList.remove('hidden');
}

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

    // ─── URL Load handler ──────────────────────────────────────────────
    dom.urlLoadBtn.addEventListener('click', () => {
        handleUrl(dom.urlInput.value);
    });

    dom.urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleUrl(dom.urlInput.value);
        }
    });

    // ─── Sample button handler ──────────────────────────────────────────
    dom.sampleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        generateSampleAudio();
    });

    // ─── Sample URL link in hint text ───────────────────────────────────
    dom.sampleUrlLink.addEventListener('click', (e) => {
        e.preventDefault();
        generateSampleAudio();
    });

    resetAll();
});
