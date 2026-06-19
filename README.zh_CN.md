# Gosper OpenClaw WeChat

`Gosper/openclaw-wechat` 是面向 Gosper 的 OpenClaw 微信 transport 插件包。

它使用 OpenClaw/iLink 的微信 transport API：

- `get_bot_qrcode`
- `get_qrcode_status`
- `getupdates`
- `sendmessage`

它不会注册 OpenClaw channel runtime，也不会把微信消息送进 OpenClaw LLM 层。微信入站消息会直接通过 Gosper trigger 进入 Gosper Supervisor。

## 架构

```text
微信用户
  -> openclaw-wechat 常驻 bridge
  -> Gosper /api/tools/triggers/wechat
  -> Gosper Supervisor
  -> Gosper WeChat tool facade
  -> openclaw-wechat /v1/wechat/tools/execute
  -> iLink sendmessage
  -> 微信用户
```

## 安装

本地开发：

```bash
npm install
npm test
```

作为 OpenClaw plugin 安装：

```bash
openclaw plugins install ./openclaw-wechat
```

说明：这个 package 有 `openclaw.plugin.json` 和 `package.json#openclaw`，所以 OpenClaw 可以识别它是 native plugin package。它没有 `channels` 字段，这是有意的。

## 生成配置

```bash
npx gosper-openclaw-wechat env \
  --gosper-base-url https://gosper-ashen.vercel.app \
  --bridge-base-url https://wechat-bridge.example.com
```

输出会分成两段：

- Bridge host env
- Gosper Vercel env

两个共享 secret 必须成对一致：

| Bridge host | Gosper Vercel |
| --- | --- |
| `OPENCLAW_WECHAT_BRIDGE_TOKEN` | `GOSPER_WECHAT_TOOL_TOKEN` |
| `OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET` | `GOSPER_WECHAT_TRIGGER_SECRET` |

## 启动 bridge

直接启动：

```bash
npm run bridge
```

或：

```bash
gosper-openclaw-wechat start
```

Docker Compose：

```bash
cp env.example .env
docker compose -f deploy/compose.yaml --env-file .env up -d --build
```

生产环境必须满足：

- bridge 是常驻进程；
- bridge public URL 使用 HTTPS；
- `/data/openclaw-wechat` 是持久化 volume；
- `OPENCLAW_WECHAT_BRIDGE_STATE_SECRET` 已设置；
- `/healthz` 返回 `stateEncrypted: true`。

## Gosper 侧配置

在 Gosper Vercel project 设置：

```env
GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com
GOSPER_WECHAT_TOOL_TOKEN=<same as OPENCLAW_WECHAT_BRIDGE_TOKEN>
GOSPER_WECHAT_TRIGGER_SECRET=<same as OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET>
GOSPER_APP_BASE_URL=https://gosper-ashen.vercel.app
```

设置后重新部署 Gosper。

## 验收

检查 bridge：

```bash
curl -sS https://wechat-bridge.example.com/healthz
```

用 Gosper probe 完整验收：

```bash
npm run wechat:probe -- \
  --bridge-base-url "$GOSPER_WECHAT_TOOL_BASE_URL" \
  --callback-base-url "$GOSPER_APP_BASE_URL" \
  --show-qr \
  --wait-connected \
  --send-after-connected \
  --wait-supervisor-interaction \
  --output ./evidence/wechat-probe-current.json
```

## 和 `@tencent-weixin/openclaw-weixin` 的区别

`@tencent-weixin/openclaw-weixin` 是 OpenClaw channel plugin，会把微信作为 OpenClaw channel 接入。

本项目是 Gosper transport bridge plugin package：

- 使用 iLink transport；
- 不声明 `channels`；
- 不走 OpenClaw LLM；
- 微信消息直接进入 Gosper Supervisor。
