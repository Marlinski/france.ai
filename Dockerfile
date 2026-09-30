FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Snapshot of the Service-Public.fr fiches, so the server starts without a download.
# The server refreshes it daily on its own.
FROM deps AS index
COPY src ./src
COPY scripts ./scripts
RUN node scripts/build-index.ts

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY --from=index /app/data ./data
USER node
EXPOSE 8080
# node:sqlite (the question journal) still flags itself experimental on Node 24.
CMD ["node", "--max-old-space-size=900", "--disable-warning=ExperimentalWarning", "src/server.ts"]
