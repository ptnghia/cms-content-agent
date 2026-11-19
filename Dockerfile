# cms-content-agent — backend + widget. Agent CLIs are installed from npm at build time.
#   docker build -t cms-content-agent .
#   docker build --build-arg INSTALL_CODEX=1 -t cms-content-agent .
FROM node:22-bookworm-slim

ARG INSTALL_CLAUDE=1
ARG INSTALL_CODEX=0
ARG CLAUDE_CODE_VERSION=latest
ARG CODEX_VERSION=latest
RUN set -eux; \
    if [ "$INSTALL_CLAUDE" = "1" ]; then npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; fi; \
    if [ "$INSTALL_CODEX" = "1" ]; then npm install -g "@openai/codex@${CODEX_VERSION}"; fi; \
    npm cache clean --force

WORKDIR /app
# The only npm dependency is the Anthropic SDK (AGENT_BACKEND=api).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    SITES_FILE=/app/config/sites.json

# Never run as root: root ignores the read-only file modes that protect synced data from the agent.
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.mjs"]
