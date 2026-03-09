#!/bin/bash
set -e

echo "Starting NTUC EWS setup..."

# Create data lake directories
mkdir -p data-lake/raw
touch data-lake/raw/.gitkeep

# Copy .env.example to .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env created from .env.example"
fi

# Install root dependencies
npm install

# Setup worker service
echo "Setting up worker-service..."
cd worker-service
npm install
npm run db:init
cd ..

# Setup web platform
echo "Setting up web-platform..."
cd web-platform
npm install
cd ..

echo "Setup complete. Run 'npm run dev' to start."
