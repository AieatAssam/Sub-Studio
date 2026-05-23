# SubStudio 🎬

**AI subtitle generation. 100% in your browser. Zero network after load.**

Drop a video (or paste a URL, or click "Try sample") → the browser's native decoders extract the audio → Transformers.js runs Whisper locally → timestamped subtitles appear → edit inline → export as SRT, VTT, or TXT. The entire pipeline stays on your machine. No uploads, no servers, no accounts.

---

## Quick Start

```
git clone https://github.com/AieatAssam/substudio.git
# Push to GitHub, enable Pages → source "GitHub Actions"
# That's it. No build step, no npm install, no backend.
```

Or open `index.html` directly in a browser:

```
python3 -m http.server 8000
open http://localhost:8000
```

### Ways to get a video in

| Method | How |
|--------|-----|
| **Drag & drop** | Drop `.mp4` / `.webm` / `.mkv` / etc. onto the upload zone |
| **File picker** | Click the upload zone and select a file |
| **Paste URL** | Enter a CORS-enabled video URL and click Load |
| **Try sample** | Click the 🎵 button — generates a 6s synthetic WAV using Web Audio API, no external file needed |

---

## How It Works

```
                    ┌──────────────────┐
                    │  Your Video File │
                    │  (or URL/sample) │
                    └────────┬─────────┘
                             │
                    ┌────────▼──────────┐
                    │  Browser Native   │  ◄── Audio extraction
                    │  Audio Decoders   │     16kHz mono PCM
                    │ (decodeAudioData) │     via Web Audio API
                    └────────┬──────────┘
                             │
                    ┌────────▼──────────┐
                    │ MediaRecorder     │  ◄── Fallback for mobile
                    │  (capture path)   │     or container formats
                    └────────┬──────────┘       that can't be decoded
                             │                  directly
                    ┌────────▼────────┐
                    │  Transformers.js │  ◄── Whisper tiny.en
                    │ (WebGPU / WASM) │     Word-level timestamps
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Subtitle Engine │  ◄── Segment → SRT/VTT/TXT
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Edit & Export │  ◄── Inline editor
                    │  SRT · VTT · TXT│     Copy or download
                    └─────────────────┘
```

### Component stack

| Layer | Library | What it does |
|-------|---------|-------------|
| Audio extraction | Browser Web Audio API (`decodeAudioData`) | Decodes audio natively, resamples to 16kHz mono PCM; falls back to `MediaRecorder` for containers browsers can't decode directly |
| AI transcription | [Transformers.js](https://huggingface.co/docs/transformers.js) v2+ | Runs Whisper tiny.en via ONNX Runtime Web (WebGPU or WASM fallback) |
| Subtitle formats | Inline (`subtitle-utils.js`) | SRT, VTT, TXT generation — all pure functions, zero dependencies |
| N/A | None needed | All processing uses browser-native APIs that don't require special HTTP headers |
| Sample generation | Web Audio API | Synthesizes 6s of speech-like audio with sawtooth oscillator + envelope shaping |

---

## Deploy to GitHub Pages

Push this repo and enable Pages. The included workflow handles everything — it's a static site with no build step.

Enable Pages at **Settings → Pages → Source: GitHub Actions**.

---

## Testing

```bash
# Install agent-browser
npm install -g agent-browser

# Run the full suite (starts a local server automatically)
bash tests/run-all.sh

# Run only browser tests against an existing server
bash tests/run-all.sh --server

# Run a specific test
bash tests/run-all.sh 03
```

Test structure:
```
tests/
├── unit/              # Node.js .mjs files — pure function testing
│   ├── time-format.test.mjs
│   ├── subtitle-generators.test.mjs
│   └── file-validation.test.mjs
├── browser/           # agent-browser shell scripts — DOM + interaction testing
│   ├── 01-initial-state.test.sh
│   ├── 02-file-validation.test.sh
│   ├── 03-ui-elements.test.sh
│   ├── 04-interaction-flow.test.sh
│   ├── 05-results-display.test.sh
│   ├── 06-subtitle-editing.test.sh
│   ├── 07-state-transitions.test.sh
│   ├── 08-responsive-layout.test.sh
│   ├── 09-error-modes.test.sh
│   └── 10-url-and-sample.test.sh
├── fixtures/          # Short test videos & invalid files
├── run-all.sh         # Test harness
└── screenshots/       # Captured during runs
```

CI tests run automatically on push via `.github/workflows/test.yml`.

---

## Performance

| Model | Size | Speed (10s audio) |
|-------|------|-------------------|
| Whisper tiny.en | ~40MB download (INT8 quantized) | ~5-15s with WebGPU, ~20-40s with WASM |

- Model is cached in IndexedDB after first download → works offline
- Audio extraction via native browser decoders usually completes in 1-5s depending on video length

---

## Technical Challenges & Workflow

### Audio extraction without a server

The original SubStudio used FFmpeg.wasm to extract audio from videos. That approach worked but had a significant cost: FFmpeg.wasm requires `SharedArrayBuffer`, which needs COOP/COEP HTTP headers that GitHub Pages doesn't send. The workaround — a service worker that injects headers on every response — worked but added complexity.

The current version takes a different approach: the browser's own `AudioContext.decodeAudioData()` is used to decode video files. Modern browsers ship with software decoders for most video formats (MP4/AAC, WebM/Opus, MOV/AAC), so the native decoder pipeline can extract raw PCM audio without any WASM at all.

When `decodeAudioData` fails — typically on mobile browsers that refuse to decode video containers through the audio API, or for formats the browser doesn't natively support — a fallback strategy kicks in: the video is loaded into a hidden `<video>` element, routed through `createMediaElementSource` to a `MediaStream`, and captured via `MediaRecorder`. The captured blob is then decoded back to PCM. This is slower (it plays through the video in real-time) but covers every format the browser can display.

Between these two strategies, the browser's native multimedia pipeline handles what would otherwise require a 30MB WebAssembly download with multi-threaded WASM support. The trade-off is format coverage: desktop Chrome can decode almost anything, but older Safari and mobile browsers may need the fallback path.

### No server-side headers needed

The original SubStudio used FFmpeg.wasm, which required `SharedArrayBuffer` and therefore COOP/COEP HTTP headers that GitHub Pages doesn't send. The current version uses the browser's native Web Audio API for audio extraction, which needs none of that. No service workers, no header workarounds, no hosting requirements. Push to any static host and it works.

### Neural network inference without a server

Transformers.js compiles Hugging Face models to ONNX format and runs them through ONNX Runtime Web. The Whisper tiny.en model is an INT8-quantized ~40MB neural network with approximately 39 million parameters. Loading it triggers a download from the Hugging Face CDN (cached in IndexedDB forever after), then the browser's WebGPU API — if available — dispatches matrix multiplications to the local GPU.

When WebGPU is unavailable, it falls back to WASM with SIMD, running the same neural network on the CPU at roughly one-third the speed. The audio is chunked into 30-second windows with 5-second overlap, which means a 90-minute lecture is processed as 180 overlapping segments, each one running through the full 39-million-parameter transformer.

### Synthesizing test data from nothing

The "Try sample" button generates a 6-second WAV file using the Web Audio API's `OfflineAudioContext`. It creates a sawtooth oscillator — the richest harmonic content in the Web Audio API's built-in waveform types — and sweeps its frequency between 180Hz and 500Hz while a gain envelope pulses at roughly syllable cadence. The raw `Float32Array` buffer is then packed into a WAV container with a hand-coded 44-byte RIFF header.

The same `encodeWav` function that packs this synthetic audio is also used internally for resampled audio buffers. The sample button tests the entire transcription pipeline end-to-end without requiring a video file on disk or a network request.

### Time formatting without rounding errors

Subtitle timestamps require millisecond precision, but IEEE 754 floating point represents `125.678` as `125.677999999999...`. The naive approach — extracting fractional seconds with `Math.floor((s % 1) * 1000)` — produces off-by-one errors at seemingly arbitrary values.

The solution is to round to the nearest millisecond first (`Math.round(seconds * 1000)`), then decompose the integer milliseconds into hours, minutes, seconds, and centiseconds using integer division. This guarantees that `125.678` formats as `00:02:05,678` every time, on every JavaScript engine, regardless of how the underlying IEEE 754 rounding falls.

### The impedance mismatch between SRT and VTT boundaries

SRT and VTT look nearly identical but have three incompatible details: SRT uses commas (`,`) for millisecond separators while VTT uses periods (`.`); SRT requires sequential integer indices before each entry while VTT uses none; SRT entries are separated by a blank line (implicit from trailing `\n` + `join('\n')`) while VTT uses double newlines after a `WEBVTT` header.

Export format switching updates three things simultaneously: the timestamp format (commas ↔ dots), the entry structure (indices + blank lines ↔ WEBVTT header + double newlines), and the download filename extension. Each format's generator is a pure function returning a string — no state, no side effects, trivially testable.

### Testing a browser-only audio pipeline in CI

The full pipeline (native audio extraction → Whisper → subtitle generation) requires WebGPU, ~40MB of model weights, and browser-level WASM support — none of which is available in typical CI runners. The test strategy splits into three layers:

1. **Unit tests** (Node.js, zero browser) test every pure formatting and validation function with 130+ assertions. These run in milliseconds.
2. **Browser DOM tests** (`agent-browser`) verify that every UI element exists, every state transition renders correctly, and every interaction produces the expected DOM mutation. These run headless Playwright.
3. **Pipeline integration** is tested via the "Try sample" path — which generates audio entirely within the browser's Web Audio API, feeds it through the real Whisper pipeline, and renders results. This works wherever the end user's browser works, which is the final arbiter anyway.

The 10 browser tests capture screenshots at every significant visual state. These images serve as both documentation and regression detection — a layout change that shifts a button by 2 pixels is immediately visible.

---

## Browser Support

| Browser | WebGPU | WASM SIMD | Status |
|---------|--------|-----------|--------|
| Chrome 113+ | ✅ | ✅ | Best experience |
| Edge 113+ | ✅ | ✅ | Best experience |
| Firefox 125+ | ✅ | ✅ | Good |
| Safari 18+ | ✅ | ✅ | Limited |

Chrome/Edge recommended for WebGPU acceleration (~3× faster transcription).

---

## Privacy

This application makes zero network requests after the initial page load. The AI model is downloaded once from Hugging Face's CDN (~40MB) and cached in IndexedDB. Your video file, the extracted audio, the transcribed text — none of it ever leaves your device.

---

## License

MIT — do whatever you want with it.
