/* subtitle-utils.js — Pure formatting & generation functions
 * No DOM, no CDN imports. Testable in Node.js or the browser.
 */

// ─── Time Formatting ─────────────────────────────────────────────────────────
// Uses integer arithmetic to avoid IEEE 754 floating point drift.

export function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '00:00:00,000';
    const totalMs = Math.round(seconds * 1000);
    if (totalMs < 0) return '00:00:00,000';
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const cs = totalMs % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(cs).padStart(3, '0')}`;
}

export function formatTimeVTT(seconds) {
    if (!Number.isFinite(seconds)) return '00:00:00.000';
    const totalMs = Math.round(seconds * 1000);
    if (totalMs < 0) return '00:00:00.000';
    const h = Math.floor(totalMs / 3600000);
    const m = Math.floor((totalMs % 3600000) / 60000);
    const s = Math.floor((totalMs % 60000) / 1000);
    const cs = totalMs % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(3, '0')}`;
}

// ─── Subtitle Format Generators ──────────────────────────────────────────────

export function generateSRT(subtitles) {
    return subtitles.map((sub, i) => {
        return `${i + 1}\n${formatTime(sub.start)} --> ${formatTime(sub.end)}\n${sub.text}\n`;
    }).join('\n');
}

export function generateVTT(subtitles) {
    return 'WEBVTT\n\n' + subtitles.map((sub) => {
        return `${formatTimeVTT(sub.start)} --> ${formatTimeVTT(sub.end)}\n${sub.text}`;
    }).join('\n\n');
}

export function generateTXT(subtitles) {
    return subtitles.map((sub) => {
        const start = formatTime(sub.start);
        const end = formatTime(sub.end);
        return `[${start} --> ${end}] ${sub.text}`;
    }).join('\n');
}

export function generatePreview(subtitles) {
    return subtitles.map((sub, i) => {
        const start = formatTimeVTT(sub.start);
        const end = formatTimeVTT(sub.end);
        return `${start} --> ${end}\n${sub.text}`;
    }).join('\n\n');
}

// ─── File Validation ─────────────────────────────────────────────────────────

export function isValidVideoFile(file) {
    const videoTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo',
                        'video/x-matroska', 'video/mkv'];
    const ext = (file.name || '').split('.').pop()?.toLowerCase();
    const videoExts = ['mp4', 'webm', 'ogv', 'ogg', 'mov', 'avi', 'mkv', 'm4v', 'flv', 'wmv'];
    return videoTypes.includes(file.type) || videoExts.includes(ext);
}

export function isAudioFile(file) {
    return file.type.startsWith('audio/');
}

export function isFileSizeValid(size) {
    return Number.isFinite(size) && size >= 0 && size <= 2 * 1024 * 1024 * 1024; // 2GB max
}

// ─── Edge Cases Helpers ──────────────────────────────────────────────────────

export function parseWhisperChunks(chunks) {
    if (!chunks || chunks.length === 0) return [];

    return chunks.map((chunk, i) => ({
        index: i + 1,
        start: chunk.timestamp[0] ?? 0,
        end: chunk.timestamp[1] ?? (chunk.timestamp[0] ?? 0) + 2,
        text: (chunk.text || '').trim(),
    })).filter(s => s.text.length > 0);
}

export function estimateDurationFromWav(buffer) {
    if (!buffer || buffer.byteLength < 44) return 0;
    const view = new DataView(buffer);
    if (view.getUint32(0) !== 0x52494646) return 0; // not RIFF
    const dataSize = view.getUint32(4, true);
    const sampleRate = view.getUint32(24, true);
    const channels = view.getUint16(22, true);
    const bitsPerSample = view.getUint16(34, true);
    if (!sampleRate || !channels || !bitsPerSample) return 0;
    const dataBytes = dataSize - 36;
    const denom = sampleRate * channels * (bitsPerSample / 8);
    return denom > 0 ? dataBytes / denom : 0;
}
