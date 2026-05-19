// Unit tests: formatTime / formatTimeVTT
// Run: node tests/unit/time-format.test.mjs

import { formatTime, formatTimeVTT } from '../../subtitle-utils.js';

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

// ─── formatTime tests (SRT format: HH:MM:SS,mmm) ──────────────────────────────

console.log('\n📐 formatTime (SRT format)');

assertEq(formatTime(0), '00:00:00,000', '0 seconds');
assertEq(formatTime(1.5), '00:00:01,500', '1.5 seconds');
assertEq(formatTime(61), '00:01:01,000', '61 seconds (1m1s)');
assertEq(formatTime(3661), '01:01:01,000', '3661 seconds (1h1m1s)');
assertEq(formatTime(86399), '23:59:59,000', '86399 seconds (23:59:59)');
assertEq(formatTime(0.001), '00:00:00,001', '1ms');
assertEq(formatTime(0.999), '00:00:00,999', '999ms');
assertEq(formatTime(125.678), '00:02:05,678', '125.678 seconds (2m5s678ms, no float drift)');
assertEq(formatTime(125.6789), '00:02:05,679', '125.6789 seconds (rounds to 679ms)');
assertEq(formatTime(59.999), '00:00:59,999', '59.999 seconds');
assertEq(formatTime(59.9999), '00:01:00,000', '59.9999 seconds rounds up to 1m');
assertEq(formatTime(3599.999), '00:59:59,999', '3599.999 seconds (just under 1h)');
assertEq(formatTime(3600), '01:00:00,000', '3600 seconds (exactly 1 hour)');
assertEq(formatTime(0.123456), '00:00:00,123', 'sub-millisecond truncation');

// Edge cases
assertEq(formatTime(-1), '00:00:00,000', 'negative seconds clamped to zero');
assertEq(formatTime(NaN), '00:00:00,000', 'NaN (clamped via Math.round)');
assertEq(formatTime(undefined), '00:00:00,000', 'undefined (clamped via Math.round)');
assertEq(formatTime(0.0005), '00:00:00,001', 'sub-ms rounding up');
assertEq(formatTime(0.0004), '00:00:00,000', 'sub-ms rounding down');

// ─── formatTimeVTT tests (VTT format: HH:MM:SS.mmm) ───────────────────────────

console.log('\n📐 formatTimeVTT (VTT format)');

assertEq(formatTimeVTT(0), '00:00:00.000', '0 seconds (VTT)');
assertEq(formatTimeVTT(1.5), '00:00:01.500', '1.5 seconds (VTT)');
assertEq(formatTimeVTT(61), '00:01:01.000', '61 seconds (VTT)');
assertEq(formatTimeVTT(3661), '01:01:01.000', '3661 seconds (VTT)');
assertEq(formatTimeVTT(125.678), '00:02:05.678', '125.678 seconds (VTT, no float drift)');
assertEq(formatTimeVTT(0.001), '00:00:00.001', '1ms (VTT)');

// Comma vs period — the only difference between SRT and VTT
const srtV = formatTime(125.678);
const vttV = formatTimeVTT(125.678);
assert(srtV.includes(',') && vttV.includes('.'), 'SRT uses comma, VTT uses period');
assert(srtV.replace(',', '.') === vttV, 'SRT and VTT are identical except comma vs period');

console.log(`\n📊 Time format: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
