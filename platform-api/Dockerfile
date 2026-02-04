FROM node:20-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3 and ffmpeg for audio conversion
RUN apk add --no-cache python3 make g++ ffmpeg sox

COPY package*.json ./
RUN npm install --production

COPY src ./src

# Create data directory and prompts directory
RUN mkdir -p /app/data /app/prompts /app/uploads

# Run migrations and seeding on startup
# seed.js runs base seeding, then automatically calls seed-ivr-flows.js if new sounds exist
CMD ["sh", "-c", "node src/db/migrate.js && node src/db/seed.js 2>/dev/null; node src/index.js"]
