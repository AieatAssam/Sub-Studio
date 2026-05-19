// Unit tests: isValidVideoFile / isAudioFile / isFileSizeValid / estimateDurationFromWav
// Run: node tests/unit/file-validation.test.mjs

import { isValidVideoFile, isAudioFile, isFileSizeValid, estimateDurationFromWav } from '../../subtitle-utils.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        console.log(`  ✅ PASS: ${label}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${label}`);
        failed++;
    }
}

function assertEq(actual, expected, label) {
    const ok = actual === expected;
    if (ok) {
        console.log(`  ✅ PASS: ${label}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${label} — expected "${expected}", got "${actual}"`);
        failed++;
    }
}

// Helper: create a fake File-like object
function fakeFile(name, type) {
    return { name, type };
}

// ─── isValidVideoFile tests ─────────────────────────────────────────────────

console.log('\n📐 isValidVideoFile');

// Valid by MIME type
assert(isValidVideoFile(fakeFile('video.mp4', 'video/mp4')), 'video/mp4 MIME');
assert(isValidVideoFile(fakeFile('clip.webm', 'video/webm')), 'video/webm MIME');
assert(isValidVideoFile(fakeFile('movie.ogg', 'video/ogg')), 'video/ogg MIME');
assert(isValidVideoFile(fakeFile('recording.mov', 'video/quicktime')), 'video/quicktime MIME');
assert(isValidVideoFile(fakeFile('capture.avi', 'video/x-msvideo')), 'video/x-msvideo MIME');
assert(isValidVideoFile(fakeFile('file.mkv', 'video/x-matroska')), 'video/x-matroska MIME');

// Valid by extension only (MIME missing/unknown)
assert(isValidVideoFile(fakeFile('test.mp4', '')), 'empty MIME, .mp4 ext');
assert(isValidVideoFile(fakeFile('test.MP4', '')), 'uppercase .MP4 ext');
assert(isValidVideoFile(fakeFile('test.mkv', '')), 'empty MIME, .mkv ext');
assert(isValidVideoFile(fakeFile('test.webm', '')), 'empty MIME, .webm ext');
assert(isValidVideoFile(fakeFile('test.mov', '')), 'empty MIME, .mov ext');
assert(isValidVideoFile(fakeFile('test.avi', '')), 'empty MIME, .avi ext');
assert(isValidVideoFile(fakeFile('test.flv', '')), 'empty MIME, .flv ext');
assert(isValidVideoFile(fakeFile('test.wmv', '')), 'empty MIME, .wmv ext');
assert(isValidVideoFile(fakeFile('test.m4v', '')), 'empty MIME, .m4v ext');
assert(isValidVideoFile(fakeFile('test.ogv', '')), 'empty MIME, .ogv ext');

// Invalid
assert(!isValidVideoFile(fakeFile('doc.pdf', 'application/pdf')), 'PDF is not video');
assert(!isValidVideoFile(fakeFile('song.mp3', 'audio/mpeg')), 'MP3 audio is not video');
assert(!isValidVideoFile(fakeFile('text.txt', 'text/plain')), 'text file is not video');
assert(!isValidVideoFile(fakeFile('image.png', 'image/png')), 'image is not video');
assert(!isValidVideoFile(fakeFile('data.zip', 'application/zip')), 'zip is not video');
assert(!isValidVideoFile(fakeFile('script.js', 'text/javascript')), 'JS file is not video');
assert(!isValidVideoFile(fakeFile('noextension', '')), 'no extension is not video');
assert(!isValidVideoFile(fakeFile('video.exe', 'application/x-msdownload')), '.exe is not video');
assert(!isValidVideoFile(fakeFile('', '')), 'empty name is not video');

// ─── isAudioFile tests ──────────────────────────────────────────────────────

console.log('\n📐 isAudioFile');

assert(isAudioFile(fakeFile('song.mp3', 'audio/mpeg')), 'audio/mpeg');
assert(isAudioFile(fakeFile('voice.wav', 'audio/wav')), 'audio/wav');
assert(isAudioFile(fakeFile('recording.ogg', 'audio/ogg')), 'audio/ogg');
assert(isAudioFile(fakeFile('podcast.aac', 'audio/aac')), 'audio/aac');
assert(isAudioFile(fakeFile('music.flac', 'audio/flac')), 'audio/flac');
assert(isAudioFile(fakeFile('speech.webm', 'audio/webm')), 'audio/webm');
assert(!isAudioFile(fakeFile('video.mp4', 'video/mp4')), 'video is not audio');
assert(!isAudioFile(fakeFile('doc.pdf', 'application/pdf')), 'PDF is not audio');
assert(!isAudioFile(fakeFile('', '')), 'empty is not audio');

// ─── isFileSizeValid tests ──────────────────────────────────────────────────

console.log('\n📐 isFileSizeValid');

assert(isFileSizeValid(0), '0 bytes is valid');
assert(isFileSizeValid(1024), '1KB is valid');
assert(isFileSizeValid(1024 * 1024 * 100), '100MB is valid');
assert(isFileSizeValid(1024 * 1024 * 1024), '1GB is valid');
assert(isFileSizeValid(2 * 1024 * 1024 * 1024), 'exactly 2GB is valid (boundary)');
assert(!isFileSizeValid(2 * 1024 * 1024 * 1024 + 1), '2GB+1 is invalid');
assert(!isFileSizeValid(3 * 1024 * 1024 * 1024), '3GB is invalid');
assert(!isFileSizeValid(Infinity), 'Infinity is invalid');
assert(!isFileSizeValid(NaN), 'NaN is invalid');
assert(!isFileSizeValid(-0.001), 'negative is invalid (below 0)');

// ─── estimateDurationFromWav tests ──────────────────────────────────────────

console.log('\n📐 estimateDurationFromWav');

// Create a synthetic WAV buffer: 1 second of 16-bit mono at 16000Hz
function makeWavBuffer(durationSec, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
    const bytesPerSample = bitsPerSample / 8;
    const dataBytes = durationSec * sampleRate * channels * bytesPerSample;
    const buf = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buf);

    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataBytes, true); // file size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // fmt chunk
    view.setUint32(12, 0x666D7420, false); // "fmt "
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
    view.setUint16(32, channels * bytesPerSample, true); // block align
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataBytes, true);

    return buf;
}

assertEq(estimateDurationFromWav(makeWavBuffer(0)), 0, '0 duration WAV → 0');
assertEq(Math.round(estimateDurationFromWav(makeWavBuffer(1))), 1, '1 sec WAV → ~1s');
assertEq(Math.round(estimateDurationFromWav(makeWavBuffer(3))), 3, '3 sec WAV → ~3s');
assertEq(Math.round(estimateDurationFromWav(makeWavBuffer(10))), 10, '10 sec WAV → ~10s');
assertEq(Math.round(estimateDurationFromWav(makeWavBuffer(60))), 60, '60 sec WAV → ~60s');

// Different sample rates
assertEq(Math.round(estimateDurationFromWav(makeWavBuffer(5, 44100))), 5, '44100Hz → still ~5s');

// Stereo
assertEq(Math.round(estimateDurationFromWav(makeWavBuffer(2, 16000, 2))), 2, 'stereo → still ~2s');

// Invalid/non-WAV buffers
assertEq(estimateDurationFromWav(new ArrayBuffer(0)), 0, 'empty buffer → 0');
assertEq(estimateDurationFromWav(new ArrayBuffer(12)), 0, 'small non-RIFF buffer → 0');
const nonRiff = new ArrayBuffer(100);
new DataView(nonRiff).setUint32(0, 0x00000000, false); // Not "RIFF"
assertEq(estimateDurationFromWav(nonRiff), 0, 'non-RIFF buffer → 0');

// Unknown sample rate
const wavBad = makeWavBuffer(1);
new DataView(wavBad).setUint32(24, 0, true); // zero sample rate
assertEq(estimateDurationFromWav(wavBad), 0, 'zero sample rate → 0');

console.log(`\n📊 File validation: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
