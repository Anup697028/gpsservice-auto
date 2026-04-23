FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install full dependencies for TypeScript build.
COPY package*.json ./
RUN npm ci

# Copy source and build API output.
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002

RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ca-certificates wget \
	&& rm -rf /var/lib/apt/lists/*

# Copy package manifests and Prisma schema before install.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci && npm cache clean --force

# Copy only compiled output needed at runtime.
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts

# Run as non-root user for safer container runtime.
RUN groupadd -r app && useradd -r -g app app
USER app

EXPOSE 3002
CMD ["node", "scripts/start-production.cjs"]
