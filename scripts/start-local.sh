#!/bin/bash

echo "Starting NTUC EWS services..."

# Start worker service
cd worker-service
npm start &
WORKER_PID=$!
cd ..

# Start web platform
cd web-platform
npm run dev &
WEB_PID=$!
cd ..

echo "Services started (Worker PID: $WORKER_PID, Web PID: $WEB_PID)"
echo "Press Ctrl+C to stop all services."

# Handle shutdown
trap "kill $WORKER_PID $WEB_PID; exit" INT TERM
wait
