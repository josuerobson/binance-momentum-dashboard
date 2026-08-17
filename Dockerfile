FROM --platform=linux/amd64 node:22-slim

WORKDIR /app

COPY . .

RUN npm install -g corepack@latest \
    && corepack pnpm install --frozen-lockfile \
    && corepack pnpm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "node scripts/init-db.mjs && exec node dist/index.js"]
