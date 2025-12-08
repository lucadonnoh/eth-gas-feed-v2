#!/bin/bash
# Run this once on Railway to add block_timestamp column

echo "🔄 Running Railway migration..."
node services/add-timestamp.js
echo "✅ Migration complete!"
