#!/usr/bin/env bash
# SubStudio Test Runner — Red-Green-Refactor TDD
#
# Usage:
#   ./tests/run-all.sh              # Run all tests (starts server automatically)
#   ./tests/run-all.sh --server     # Run all tests against a running server
#   ./tests/run-all.sh --fix        # Autofix failures (if supported)
#   ./tests/run-all.sh 02           # Run only test 02
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WORKSPACE_DIR="$(dirname "$PROJECT_DIR")"
SCREENSHOTS="$SCRIPT_DIR/screenshots"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
PASSED=0
FAILED=0
FAILED_TESTS=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║        SubStudio — Red-Green-Refactor Test Suite           ║"
echo "║        $(date)          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ─── Parse args ───────────────────────────────────────────────────────────────
KEEP_SERVER=false
RUN_FILTER=""
BASE_PATH="auto"
for arg in "$@"; do
    case "$arg" in
        --server) KEEP_SERVER=true ;;
        --fix) echo "Auto-fix mode TBD"; exit 0 ;;
        --base-path) BASE_PATH="auto" ;;
        --base-path=*) BASE_PATH="${arg#--base-path=}" ;;
        [0-9]*) RUN_FILTER="$arg" ;;
    esac
done

# ─── Find tests ───────────────────────────────────────────────────────────────
UNIT_TESTS=()
BROWSER_TESTS=()

if [ -n "$RUN_FILTER" ]; then
    for f in "$SCRIPT_DIR/unit/"*".test.mjs"; do
        if echo "$f" | grep -q "$RUN_FILTER"; then UNIT_TESTS+=("$f"); fi
    done
    for f in "$SCRIPT_DIR/browser/"*".test.sh"; do
        if echo "$f" | grep -q "$RUN_FILTER"; then BROWSER_TESTS+=("$f"); fi
    done
else
    for f in "$SCRIPT_DIR/unit/"*".test.mjs"; do UNIT_TESTS+=("$f"); done
    for f in "$SCRIPT_DIR/browser/"*".test.sh"; do BROWSER_TESTS+=("$f"); done
fi

TOTAL_TESTS=$((${#UNIT_TESTS[@]} + ${#BROWSER_TESTS[@]}))
if [ $TOTAL_TESTS -eq 0 ]; then
    echo -e "${RED}❌ No tests found${NC}"
    exit 1
fi

echo -e "${CYAN}Found ${#UNIT_TESTS[@]} unit test(s) + ${#BROWSER_TESTS[@]} browser test(s) = $TOTAL_TESTS total${NC}"
echo ""

# ─── Ensure agent-browser is available ────────────────────────────────────────
if ! command -v agent-browser &>/dev/null; then
    echo -e "${RED}❌ agent-browser not found. Install it first.${NC}"
    exit 1
fi

# ─── Start HTTP server if needed ──────────────────────────────────────────────
SERVER_PID=""
if [ "$KEEP_SERVER" = false ]; then
    echo -e "${YELLOW}🔧 Starting local HTTP server on port 8000...${NC}"
    # Kill any existing server on port 8000
    lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
    sleep 0.5

    cd "$WORKSPACE_DIR"
    python3 -m http.server 8000 --bind 127.0.0.1 &
    SERVER_PID=$!
    echo "   Server PID: $SERVER_PID"

    # Wait for server to be ready
    for i in $(seq 1 20); do
        # Auto-detect base path: try /substudio/index.html then /index.html
        if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/substudio/index.html 2>/dev/null | grep -q 200; then
            BASE_PATH="/substudio"
            echo -e "${GREEN}   ✅ Server is ready (substudio/ path)${NC}"
            break
        elif curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/index.html 2>/dev/null | grep -q 200; then
            BASE_PATH=""
            echo -e "${GREEN}   ✅ Server is ready (root path)${NC}"
            break
        fi
        if [ "$i" -eq 20 ]; then
            echo -e "${RED}❌ Server failed to start (cannot reach index.html)${NC}"
            kill $SERVER_PID 2>/dev/null || true
            exit 1
        fi
        sleep 0.5
    done
else
    if [ "$BASE_PATH" = "auto" ]; then
        if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/substudio/index.html 2>/dev/null | grep -q 200; then
            BASE_PATH="/substudio"
        else
            BASE_PATH=""
        fi
    fi
    echo -e "${YELLOW}📡 Using existing server at http://127.0.0.1:8000${BASE_PATH}${NC}"
fi

echo ""

# ─── Run unit tests ───────────────────────────────────────────────────────────
if [ ${#UNIT_TESTS[@]} -gt 0 ]; then
    echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  UNIT TESTS${NC}"
    echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    for TEST in "${UNIT_TESTS[@]}"; do
        TEST_NAME=$(basename "$TEST" .test.mjs)
        echo -e "${CYAN}  Running: $TEST_NAME${NC}"
        
        set +e
        node "$TEST" 2>&1
        EXIT_CODE=$?
        set -e
        
        if [ $EXIT_CODE -eq 0 ]; then
            PASSED=$((PASSED + 1))
        else
            echo -e "${RED}  ❌ $TEST_NAME FAILED${NC}"
            FAILED=$((FAILED + 1))
            FAILED_TESTS="$FAILED_TESTS unit/$TEST_NAME"
        fi
        echo ""
    done
fi

# ─── Run browser tests ────────────────────────────────────────────────────────
if [ ${#BROWSER_TESTS[@]} -gt 0 ]; then
    echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  BROWSER TESTS${NC}"
    echo -e "${CYAN}══════════════════════════════════════════════════════════${NC}"
    echo ""
    
    for TEST in "${BROWSER_TESTS[@]}"; do
        TEST_NAME=$(basename "$TEST" .test.sh)
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${CYAN}  Running: $TEST_NAME${NC}"
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""

        set +e
        TEST_BASE_URL="http://127.0.0.1:8000${BASE_PATH}"
        bash "$TEST" "$TEST_BASE_URL"
        EXIT_CODE=$?
        set -e

        if [ $EXIT_CODE -eq 0 ]; then
            echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "${GREEN}  ✅ $TEST_NAME PASSED${NC}"
            echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            PASSED=$((PASSED + 1))
        else
            echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "${RED}  ❌ $TEST_NAME FAILED (exit code: $EXIT_CODE)${NC}"
            echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            FAILED=$((FAILED + 1))
            FAILED_TESTS="$FAILED_TESTS browser/$TEST_NAME"
        fi
        echo ""
    done
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                      TEST SUMMARY                          ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo -e "║  ${GREEN}Passed: $PASSED${NC}                                         ║"
if [ "$FAILED" -gt 0 ]; then
    echo -e "║  ${RED}Failed: $FAILED${NC}                                         ║"
    echo "║  Failed tests: $FAILED_TESTS                    ║"
else
    echo "║  Failed: 0                                            ║"
fi
echo "║  Total:  $(($PASSED + $FAILED))                                           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Screenshots saved to: $SCREENSHOTS"

# ─── Cleanup ──────────────────────────────────────────────────────────────────
if [ -n "$SERVER_PID" ]; then
    echo "Stopping server..."
    kill $SERVER_PID 2>/dev/null || true
    # Also kill any python http.server children
    lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
fi

# Exit with appropriate code
if [ "$FAILED" -gt 0 ]; then
    exit 1
fi
exit 0
