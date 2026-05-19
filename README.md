# SubStudio 🎬

**AI subtitle generation. 100% in your browser. Zero network after load.**

Drop a video (or paste a URL, or click "Try sample") → FFmpeg.wasm extracts the audio → Transformers.js runs Whisper locally → timestamped subtitles appear → edit inline → export as SRT, VTT, or TXT. The entire pipeline stays on your machine. No uploads, no servers, no accounts.

---

## Quick Start

```
git clone https://github.com/AieatAssam/substudio.git
# Push to GitHub, enable Pages → source "GitHub Actions"
# That's it. No build step, no npm install, no backend.
```

Or open `index.html` directly in a browser (some features need a local HTTP server for SharedArrayBuffer support):

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
                    ┌────────▼────────┐
                    │   FFmpeg.wasm   │  ◄── Audio extraction
                    │  (WASM in-browser)│     16kHz mono PCM WAV
                    └────────┬────────┘
                             │
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
| Video processing | [FFmpeg.wasm](https://github.com/nicedoc/ffmpeg.wasm) v0.12 | Extracts audio from any video container, re-encodes to PCM 16-bit 16kHz mono |
| AI transcription | [Transformers.js](https://huggingface.co/docs/transformers.js) v2 | Runs Whisper tiny.en via ONNX Runtime Web (WebGPU or WASM fallback) |
| Subtitle formats | Inline (`subtitle-utils.js`) | SRT, VTT, TXT generation — all pure functions, zero dependencies |
| COI support | Service Worker | Cross-Origin Isolation enabling `SharedArrayBuffer` for FFmpeg |
| Sample generation | Web Audio API | Synthesizes 6s of speech-like audio with sawtooth oscillator + envelope shaping |

---

## Deploy to GitHub Pages

Push this repo and enable Pages. The included workflow handles everything:

```yaml
# .github/workflows/deploy.yml
# Push → Pages → done. No build step required.
```

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
| Whisper tiny.en | ~150MB download | ~5-15s with WebGPU, ~20-40s with WASM |

- Model is cached in IndexedDB after first download → works offline
- FFmpeg extraction usually completes in 1-5s depending on video length

---

## Technical Challenges & Workflow

### SharedArrayBuffer and static hosting

FFmpeg.wasm relies on `SharedArrayBuffer` for its multi-threaded audio processing. Modern browsers require two HTTP headers — `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` — before they'll expose the API. GitHub Pages sends neither.

The workaround is a service worker that intercepts every same-origin response and injects these headers before the page sees them. The `coi-serviceworker.js` file is 40 lines. It registers itself on page load, waits for activation, then wraps every `fetch` response with the required headers. This single file is the difference between "this works on a custom server" and "this works on GitHub Pages with zero configuration."

Without it, users would need to set up a reverse proxy or switch hosting. With it, they deploy four static files and get a desktop-grade media processing pipeline.

### Running FFmpeg in a browser tab

FFmpeg.wasm compiles the full FFmpeg C codebase to WebAssembly. The 0.12.x API requires loading core binaries from a CDN at runtime (~30MB), writing the input file to a virtual filesystem, running the extraction command, and reading the output back. The virtual filesystem is in-memory — there's no disk I/O. Everything happens inside the WASM linear memory.

This means a video file you drop onto a web page is copied into a WebAssembly sandbox, processed by the same code that powers Netflix's encoding pipeline, and returned as a blob — all without a single byte ever reaching a network socket.

### Neural network inference without a server

Transformers.js compiles Hugging Face models to ONNX format and runs them through ONNX Runtime Web. The Whisper tiny.en model is a 151MB neural network with approximately 39 million parameters. Loading it triggers a download from the Hugging Face CDN (cached in IndexedDB forever after), then the browser's WebGPU API — if available — dispatches matrix multiplications to the local GPU.

When WebGPU is unavailable, it falls back to WASM with SIMD, running the same neural network on the CPU at roughly one-third the speed. The quantization is INT8, so the model weights occupy about a third of what the full-precision version would. The audio is chunked into 30-second windows with 5-second overlap, which means a 90-minute lecture is processed as 180 overlapping segments, each one running through the full 39-million-parameter transformer.

### Synthesizing test data from nothing

The "Try sample" button generates a 6-second WAV file using the Web Audio API's `OfflineAudioContext`. It creates a sawtooth oscillator — the richest harmonic content in the Web Audio API's built-in waveform types — and sweeps its frequency between 180Hz and 500Hz while a gain envelope pulses at roughly syllable cadence. The raw `Float32Array` buffer is then packed into a WAV container with a hand-coded 44-byte RIFF header.

The same `encodeWav` function that packs this synthetic audio also packs the output from FFmpeg.wasm's audio extraction. Both paths converge on the same `Blob → File` flow, which means the sample button tests the entire transcription pipeline end-to-end without requiring a video file on disk or a network request.

### Time formatting without rounding errors

Subtitle timestamps require millisecond precision, but IEEE 754 floating point represents `125.678` as `125.677999999999...`. The naive approach — extracting fractional seconds with `Math.floor((s % 1) * 1000)` — produces off-by-one errors at seemingly arbitrary values.

The solution is to round to the nearest millisecond first (`Math.round(seconds * 1000)`), then decompose the integer milliseconds into hours, minutes, seconds, and centiseconds using integer division. This guarantees that `125.678` formats as `00:02:05,678` every time, on every JavaScript engine, regardless of how the underlying IEEE 754 rounding falls.

### The impedance mismatch between SRT and VTT boundaries

SRT and VTT look nearly identical but have three incompatible details: SRT uses commas (`,`) for millisecond separators while VTT uses periods (`.`); SRT requires sequential integer indices before each entry while VTT uses none; SRT entries are separated by a blank line (implicit from trailing `\n` + `join('\n')`) while VTT uses double newlines after a `WEBVTT` header.

Export format switching updates three things simultaneously: the timestamp format (commas ↔ dots), the entry structure (indices + blank lines ↔ WEBVTT header + double newlines), and the download filename extension. Each format's generator is a pure function returning a string — no state, no side effects, trivially testable.

### Testing a browser-only audio pipeline in CI

The full pipeline (FFmpeg → Whisper → subtitle generation) requires WebGPU, 150MB of model weights, and browser-level WASM support — none of which is available in typical CI runners. The test strategy splits into three layers:

1. **Unit tests** (Node.js, zero browser) test every pure formatting and validation function with 130+ assertions. These run in milliseconds.
2. **Browser DOM tests** (`agent-browser`) verify that every UI element exists, every state transition renders correctly, and every interaction produces the expected DOM mutation. These run headless Playwright.
3. **Pipeline integration** is tested via the "Try sample" path — which generates audio entirely within the browser's Web Audio API, feeds it through the real Whisper pipeline, and renders results. This works wherever the end user's browser works, which is the final arbiter anyway.

The 10 browser tests capture screenshots at every significant visual state. These images serve as both documentation and regression detection — a layout change that shifts a button by 2 pixels is immediately visible.

---

## Browser Support

| Browser | WebGPU | WASM SIMD | COI SW | Status |
|---------|--------|-----------|--------|--------|
| Chrome 113+ | ✅ | ✅ | ✅ | Best experience |
| Edge 113+ | ✅ | ✅ | ✅ | Best experience |
| Firefox 125+ | ✅ | ✅ | ✅ | Good |
| Safari 18+ | ✅ | ✅ | ✅ | Limited |

Chrome/Edge recommended for WebGPU acceleration (~3× faster transcription).

---

## Privacy

This application makes zero network requests after the initial page load. The AI model is downloaded once from Hugging Face's CDN (~150MB) and cached in IndexedDB. Your video file, the extracted audio, the transcribed text — none of it ever leaves your device.

---

## License

MIT — do whatever you want with it.
