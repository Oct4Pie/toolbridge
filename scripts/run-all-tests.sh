#!/bin/bash
set -e

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  🧪 TOOLBRIDGE COMPREHENSIVE TEST SUITE                      ║"
echo "║  Real Backends • No Mock Servers • All Edge Cases             ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Load environment
if [ -f .env ]; then
  source .env
  echo "✅ Loaded environment from .env"
else
  echo "⚠️  No .env file - using defaults"
fi

# Build
echo ""
echo "📦 Building TypeScript..."
npm run build > /dev/null 2>&1
echo "✅ Build complete"

# Run tests
echo ""
echo "🚀 Running comprehensive test suite..."
echo ""

npx mocha \
  "dist/src/test/integration/comprehensive-tool-calling.test.js" \
  "dist/src/test/integration/brutality.test.js" \
  --reporter spec \
  --timeout 180000

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  ✅ TEST SUITE COMPLETE                                       ║"
echo "║  All tests running against REAL backends                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
