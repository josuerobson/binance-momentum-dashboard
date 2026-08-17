FROM --platform=linux/amd64 node:22-slim

WORKDIR /app

COPY . .

RUN npm install -g corepack@latest \
    && corepack pnpm install --frozen-lockfile \
    && corepack pnpm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "echo 'CONTAINER_ALIVE' && while true; do echo 'heartbeat'; sleep 10; done"]
