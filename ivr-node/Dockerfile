FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY *.js ./
# Default to dynamic IVR engine, can be overridden with IVR_MODE=legacy
ENV IVR_MODE=dynamic
CMD ["sh", "-c", "if [ \"$IVR_MODE\" = 'legacy' ]; then npm start; else node dynamic-ivr.js; fi"]