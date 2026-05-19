# AGENTS.md — SubStudio Development Protocol

## 🧪 Red-Green-Refactor TDD Workflow

All SubStudio development follows strict TDD. No exceptions.

### The Cycle

```
RED   → Write a test that fails (the new behaviour doesn't exist yet)
GREEN → Write the minimum code to make it pass
REFACTOR → Clean up without changing behaviour
COMMIT → Only commit GREEN, never RED
```

### Test Categories (run in order)

1. **Unit tests** — Pure function tests (SRT/VTT generation, time formatting, validation logic)
2. **DOM tests** — UI element existence, state transitions, event handlers
3. **Integration tests** — Pipeline orchestration, error handling, user flow
4. **Browser tests** — agent-browser snapshots, interactions, screenshots

### Agentic Rules

1. **Never write production code before a test.** If there's no failing test, there's nothing to build.
2. **One behaviour change = one test cycle.** Batch changes require batch tests.
3. **Test must fail FIRST** (RED) to prove it's measuring the right thing.
4. **Minimum viable GREEN** — If a hardcoded return value makes the test pass, that's the first GREEN. Then write another test forcing the real implementation.
5. **Test both the sunny path and the error path.** Every `throw`, every `showError()`, every `catch` needs a test.
6. **Browser tests are not optional for UI changes.** Every new UI element, every new interaction path, every new visual state gets an agent-browser snapshot test.
7. **When you find a bug, first write a test that reproduces it (RED), then fix (GREEN).** This prevents regression.

### Browser Test Pattern

```bash
# RED: test the absence
agent-browser open http://localhost:8000
agent-browser snapshot -i
# Assert: element XYZ does not exist → test fails (RED)

# After implementing...
# GREEN: test the presence
agent-browser open http://localhost:8000
agent-browser snapshot -i
# Assert: element XYZ exists → test passes (GREEN)
```

### Test File Structure

```
tests/
├── unit/           # Pure function tests (JS)
│   ├── time-format.test.js
│   ├── subtitle-generators.test.js
│   └── file-validation.test.js
├── integration/    # Pipeline orchestration tests
│   └── pipeline.test.js
└── browser/        # agent-browser snapshot tests
    ├── 01-initial-state.test.sh
    ├── 02-upload-zone.test.sh
    ├── 03-video-container.test.sh
    └── 04-results-view.test.sh
```

### Acceptance Criteria

Before any merge/PR:
- [ ] All unit tests pass
- [ ] All browser snapshot tests pass
- [ ] No RED state left in the commit history
- [ ] Screenshots captured for every visual state
- [ ] Error states tested (invalid file, no audio track, oversized file)

### Project-Specific Test Data

Test video files live in `tests/fixtures/`. Create small test files:
- `tests/fixtures/short-video.mp4` — 3-second test video with audio (<500KB)
- `tests/fixtures/no-audio.mp4` — 3-second video with no audio track
- `tests/fixtures/invalid-file.txt` — Non-video file for error testing
