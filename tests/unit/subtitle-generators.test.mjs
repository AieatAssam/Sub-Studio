// Unit tests: generateSRT / generateVTT / generateTXT / generatePreview / parseWhisperChunks
// Run: node tests/unit/subtitle-generators.test.mjs

import {
    generateSRT, generateVTT, generateTXT, generatePreview,
    parseWhisperChunks
} from '../../subtitle-utils.js';

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

function assertIncludes(haystack, needle, label) {
    const ok = haystack.includes(needle);
    if (ok) {
        console.log(`  ✅ PASS: ${label}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${label} — expected "${needle}" in "${haystack.substring(0, 100)}"`);
        failed++;
    }
}

// Sample subtitle data
const sampleSubtitles = [
    { index: 1, start: 0, end: 2.5, text: 'Hello, world!' },
    { index: 2, start: 3.0, end: 6.75, text: 'This is a subtitle test.' },
    { index: 3, start: 10.0, end: 12.0, text: 'Line three with numbers 123.' },
];

const sampleWhisperChunks = [
    { timestamp: [0, 2.5], text: ' Hello, world! ' },
    { timestamp: [3.0, 6.75], text: 'This is a subtitle test.' },
    { timestamp: [10.0, 12.0], text: ' Line three with numbers 123. ' },
];

// ─── generateSRT tests ──────────────────────────────────────────────────────

console.log('\n📐 generateSRT');

const srt = generateSRT(sampleSubtitles);

assertIncludes(srt, '1', 'starts with subtitle index 1');
assertIncludes(srt, '00:00:00,000 --> 00:00:02,500', 'first SRT time range');
assertIncludes(srt, 'Hello, world!', 'first subtitle text');
assertIncludes(srt, '2', 'contains subtitle index 2');
assertIncludes(srt, '00:00:03,000 --> 00:00:06,750', 'second SRT time range');
assertIncludes(srt, 'This is a subtitle test.', 'second subtitle text');
assertIncludes(srt, '3', 'contains subtitle index 3');
assertIncludes(srt, '00:00:10,000 --> 00:00:12,000', 'third SRT time range');
assert(!srt.includes('WEBVTT'), 'SRT should not contain WEBVTT header');
assert(srt.trim().length > 0, 'SRT output is not empty');

// SRT format convention: each entry has blank line after
const lines = srt.split('\n');
assert(lines.length >= 9, 'SRT has enough lines for 3 entries');
assert(lines[0] === '1', 'SRT line 0 is index 1');
assert(lines[4] === '2', 'SRT line 4 is index 2 (after blank separator)');
assert(lines[8] === '3', 'SRT line 8 is index 3 (after blank separator)');

// ─── generateVTT tests ──────────────────────────────────────────────────────

console.log('\n📐 generateVTT');

const vtt = generateVTT(sampleSubtitles);

assertIncludes(vtt, 'WEBVTT', 'VTT starts with WEBVTT header');
assertIncludes(vtt, '00:00:00.000 --> 00:00:02.500', 'first VTT time range (dots not commas)');
assertIncludes(vtt, 'Hello, world!', 'first VTT text');
assertIncludes(vtt, 'This is a subtitle test.', 'second VTT text');
// Check VTT timestamp lines (not subtitle text which can have commas)
const vttLines = vtt.split('\n');
const vttTimestamps = vttLines.filter(l => l.includes('-->'));
vttTimestamps.forEach(ts => assert(!ts.includes(','), `VTT timestamp '${ts}' uses dots not commas`));
assert(vtt.includes('.'), 'VTT should use dots in timestamps');
assert(vtt.endsWith('123.'), 'VTT ends with last subtitle text');

// ─── generateTXT tests ──────────────────────────────────────────────────────

console.log('\n📐 generateTXT');

const txt = generateTXT(sampleSubtitles);

assertIncludes(txt, '[00:00:00,000 --> 00:00:02,500] Hello, world!', 'TXT first line format');
assertIncludes(txt, '[00:00:03,000 --> 00:00:06,750] This is a subtitle test.', 'TXT second line');
assert(txt.includes('[') && txt.includes(']'), 'TXT uses bracket timestamps');
assert(!txt.includes('WEBVTT'), 'TXT should not contain WEBVTT');
// TXT uses bracket timestamps: [00:00:00,000 --> 00:00:02,500]
const bracketCount = (txt.match(/\[.*?\]/g) || []).length;
assert(bracketCount === 3, 'TXT has 3 bracket-delimited timestamps');

// ─── generatePreview tests ──────────────────────────────────────────────────

console.log('\n📐 generatePreview');

const preview = generatePreview(sampleSubtitles);

assertIncludes(preview, '00:00:00.000 --> 00:00:02.500', 'preview first time range');
assertIncludes(preview, 'Hello, world!', 'preview first text');
assert(!preview.includes('WEBVTT'), 'preview should not include WEBVTT header');
assert(preview.includes('\n\n'), 'preview has blank line separators');

// ─── parseWhisperChunks tests ───────────────────────────────────────────────

console.log('\n📐 parseWhisperChunks');

const parsed = parseWhisperChunks(sampleWhisperChunks);

assert(Array.isArray(parsed), 'returns an array');
assertEq(parsed.length, 3, 'parses 3 chunks');
assertEq(parsed[0].index, 1, 'first chunk index is 1');
assertEq(parsed[0].start, 0, 'first chunk start');
assertEq(parsed[0].end, 2.5, 'first chunk end');
assertEq(parsed[0].text, 'Hello, world!', 'first chunk text trimmed');
assertEq(parsed[1].text, 'This is a subtitle test.', 'second chunk text');
assertEq(parsed[2].text, 'Line three with numbers 123.', 'third chunk text trimmed');

// Edge cases
assertEq(parseWhisperChunks(null).length, 0, 'null input returns empty array');
assertEq(parseWhisperChunks(undefined).length, 0, 'undefined input returns empty array');
assertEq(parseWhisperChunks([]).length, 0, 'empty array returns empty array');

// Chunk with single timestamp (no end)
const singleTs = [{ timestamp: [5.0], text: 'Single' }];
const singleParsed = parseWhisperChunks(singleTs);
assertEq(singleParsed[0].start, 5.0, 'single timestamp start');
assertEq(singleParsed[0].end, 7.0, 'single timestamp end defaults to start+2');
assertEq(singleParsed[0].text, 'Single', 'single timestamp text');

// Empty text chunks filtered out
const mixedChunks = [
    { timestamp: [0, 1], text: 'Valid' },
    { timestamp: [1, 2], text: '   ' },
    { timestamp: [2, 3], text: '' },
];
const mixedParsed = parseWhisperChunks(mixedChunks);
assertEq(mixedParsed.length, 1, 'empty text chunks are filtered out');
assertEq(mixedParsed[0].text, 'Valid', 'only valid chunk remains');

// Helper
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

console.log(`\n📊 Subtitle generators: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
