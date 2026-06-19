FROM node:20-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV OPENCLAW_WECHAT_BRIDGE_HOST=0.0.0.0
ENV OPENCLAW_WECHAT_BRIDGE_PORT=8787
ENV OPENCLAW_WECHAT_BRIDGE_STATE_PATH=/data/openclaw-wechat/state.json

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY bin ./bin
COPY src ./src
COPY openclaw.plugin.json ./openclaw.plugin.json

RUN mkdir -p /data/openclaw-wechat \
  && chown -R node:node /data/openclaw-wechat /app

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const port=process.env.OPENCLAW_WECHAT_BRIDGE_PORT||process.env.PORT||8787; fetch('http://127.0.0.1:'+port+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/openclaw-wechat-bridge.mjs"]
