FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci
COPY backend ./backend
COPY data ./data
RUN cd backend && node scripts/build-db.js --out /app/data/commentary.sqlite

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev && npm cache clean --force
COPY backend/src ./backend/src
COPY data/catalog.json data/attribution.json ./backend/data/
COPY --from=builder /app/data/commentary.sqlite ./backend/data/commentary.sqlite
RUN useradd --system --uid 1001 appuser && chown -R appuser:appuser /app
USER appuser
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
