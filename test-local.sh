#!/bin/bash
# Local testing script for eth-gas-feed-v2
# This script helps you test changes locally before pushing to production

set -e  # Exit on error

echo "🧪 Starting local testing workflow..."
echo ""

# 1. Run build to check for TypeScript/ESLint errors
echo "1️⃣  Running production build (linting + type checking)..."
npm run build
echo "✅ Build successful!"
echo ""

# 2. Run migration
echo "2️⃣  Running database migrations..."
npm run migrate
echo "✅ Migration successful!"
echo ""

# 3. Test API endpoint
echo "3️⃣  Testing API endpoints..."
echo "   Starting dev server briefly..."
npm run dev > /dev/null 2>&1 &
DEV_PID=$!
sleep 5

# Test blocks endpoint
echo "   Testing /api/blocks..."
BLOCKS_RESPONSE=$(curl -s http://localhost:3001/api/blocks)
if echo "$BLOCKS_RESPONSE" | grep -q "blocks"; then
    echo "   ✅ /api/blocks working"
else
    echo "   ❌ /api/blocks failed"
    kill $DEV_PID 2>/dev/null || true
    exit 1
fi

# Stop dev server
kill $DEV_PID 2>/dev/null || true
echo "✅ API tests passed!"
echo ""

echo "✅ All local tests passed! Safe to push to production."
echo ""
echo "To manually test the full application locally:"
echo "  1. Terminal 1: npm run ingest"
echo "  2. Terminal 2: npm run dev"
echo "  3. Browser: http://localhost:3001"
