FROM node:20-alpine
WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public

EXPOSE 8080
CMD ["npm","start"]
