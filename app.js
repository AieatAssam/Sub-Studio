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

let FFmpeg, fetchFile, toBlobURL;

async function loadFFmpeg() {
    if (FFmpeg) return;
    const mod = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
    const util = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js');
    FFmpeg = mod.FFmpeg;
    fetchFile = util.fetchFile;
    toBlobURL = util.toBlobURL;
}

let pipeline;
async function loadTransformers() {
    if (pipeline) return;
    const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm');
    pipeline = mod.pipeline;
}

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
    videoFile: null,
    audioBlob: null,
    transcription: null,
    subtitles: null,  // Array of {index, start, end, text}
    currentTime: 0,
    status: 'idle',   // idle | loading-ffmpeg | extracting | loading-model | transcribing | complete | error
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
        'loading-ffmpeg': '🔧',
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

// ─── Pipeline: Audio Extraction ──────────────────────────────────────────────

async function extractAudio(videoFile, onProgress) {
    onProgress(5, 'Loading FFmpeg engine...');
    await loadFFmpeg();

    const ffmpeg = new FFmpeg();
    let lastProgress = 0;

    ffmpeg.on('log', ({ message }) => {
        // FFmpeg reports progress in log messages
        const match = message.match(/out_time_us:\s*(\d+)/);
        if (match) {
            // We don't know total duration easily, so we use this as incremental
        }
    });

    ffmpeg.on('progress', ({ progress: p }) => {
        // Some versions report progress events
        const percent = Math.min(90, 10 + Math.round(p * 80));
        if (percent > lastProgress) {
            lastProgress = percent;
            onProgress(percent, 'Extracting audio track...');
        }
    });

    onProgress(8, 'Loading FFmpeg core...');
    const coreBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
        coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    onProgress(12, 'Writing video to virtual filesystem...');
    const fileData = await fetchFile(videoFile);
    await ffmpeg.writeFile('input', fileData);

    onProgress(15, 'Running FFmpeg audio extraction...');
    await ffmpeg.exec([
        '-i', 'input',
        '-vn',
        '-acodec', 'pcm_s16le',
        '-ar', '16000',
        '-ac', '1',
        'audio.wav',
    ]);

    onProgress(95, 'Reading audio output...');
    const audioData = await ffmpeg.readFile('audio.wav');

    // Clean up - release the FFmpeg instance
    // In newer @ffmpeg/ffmpeg we can just let it be GC'd

    onProgress(100, 'Audio extracted successfully!');
    return new Blob([audioData], { type: 'audio/wav' });
}

// ─── Pipeline: AI Transcription ──────────────────────────────────────────────

async function transcribeAudio(audioBlob, onProgress) {
    onProgress(5, 'Loading AI model (Whisper tiny)...');
    setStatus('loading-model', 5, 'Downloading AI model (~150MB, cached after first use)...');
    await loadTransformers();

    onProgress(30, 'Initializing transcription pipeline...');
    const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        progress_callback: (progress) => {
            if (progress.status === 'progress' && progress.file) {
                const percent = 30 + Math.round(progress.progress * 40);
                setStatus('loading-model', percent, `Loading ${progress.file}...`);
            }
        },
    });

    setStatus('transcribing', 30, 'Transcribing audio with AI...');

    // Create a mock progress callback since Whisper doesn't report incremental progress easily
    let fakeProgress = 30;
    const progressInterval = setInterval(() => {
        fakeProgress = Math.min(90, fakeProgress + 2);
        setStatus('transcribing', fakeProgress, `Processing audio...`);
    }, 1000);

    try {
        const result = await pipe(audioBlob, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: true,
        });

        clearInterval(progressInterval);
        setStatus('transcribing', 100, 'Transcription complete!');

        // Parse the result into subtitle segments
        let subtitles = parseWhisperChunks(result.chunks);

        if (subtitles.length === 0 && result.text) {
            // Fallback: if no timestamps, create one subtitle for the entire audio
            subtitles = [{
                index: 1,
                start: 0,
                end: 0,
                text: result.text.trim(),
            }];
        }

        // Also create the full text version
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
        setStatus('loading-ffmpeg', 0, 'Initializing...');
        const audioBlob = await extractAudio(videoFile, (pct, label) => {
            setStatus('extracting', pct, label);
        });

        state.audioBlob = audioBlob;

        // Step 2: Transcribe
        const result = await transcribeAudio(audioBlob, (pct, label) => {
            setStatus('transcribing', pct, label);
        });

        state.transcription = result;
        state.subtitles = result.subtitles;

        // If no timestamps (single segment without timing), estimate
        if (state.subtitles.length === 1 && state.subtitles[0].end === 0) {
            const duration = await estimateAudioDuration(audioBlob);
            if (duration > 0) {
                state.subtitles[0].end = duration;
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
    // Register COI service worker for SharedArrayBuffer support
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('coi-serviceworker.js')
            .then(() => {
                console.log('✅ COI service worker registered - SharedArrayBuffer enabled');
            })
            .catch((err) => {
                console.warn('⚠️ COI service worker registration failed:', err.message);
                console.warn('FFmpeg.wasm may not work on this platform without COOP/COEP headers');
            });
    } else {
        console.warn('⚠️ Service workers not supported - FFmpeg.wasm may not work');
    }

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
