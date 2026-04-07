FROM node:20-alpine

WORKDIR /app

# Install runtime/build deps for sqlite and media conversion.
RUN apk add --no-cache python3 make g++ ffmpeg sox

COPY package*.json ./
RUN npm install --production

COPY src ./src

# Create data directory and prompts directory
RUN mkdir -p /app/data /app/prompts /app/uploads

# Run backup, migrations, seeding on startup
CMD ["sh", "-c", "\
  if [ -f /app/data/platform.db ]; then \
    mkdir -p /app/data/backups && \
    cp /app/data/platform.db /app/data/backups/platform-$(date +%Y%m%d-%H%M%S).db && \
    ls -t /app/data/backups/platform-*.db | tail -n +6 | xargs rm -f 2>/dev/null; \
    echo '[backup] Database backed up (keeping last 5)'; \
  fi && \
  node src/db/migrate.js && node src/db/seed.js 2>/dev/null; node src/index.js"]
