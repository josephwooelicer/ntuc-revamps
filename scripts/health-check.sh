#!/bin/bash

echo "Running health checks..."

# Check Web Platform
WEB_HEALTH=$(curl -s http://localhost:3000/api/health)
if [[ $WEB_HEALTH == *"\"status\":\"ok\""* ]]; then
  echo "✅ Web Platform: OK"
else
  echo "❌ Web Platform: FAILED"
  echo "$WEB_HEALTH"
fi

# Check Worker Service
WORKER_HEALTH=$(curl -s http://localhost:4000/health)
if [[ $WORKER_HEALTH == *"\"status\":\"ok\""* ]]; then
  echo "✅ Worker Service: OK"
else
  echo "❌ Worker Service: FAILED"
  echo "$WORKER_HEALTH"
fi

# Check Data Lake
if [ -d "./data-lake/raw" ]; then
  echo "✅ Data Lake: OK"
else
  echo "❌ Data Lake: FAILED (directory missing)"
fi
