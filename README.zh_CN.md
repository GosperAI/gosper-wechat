# Gosper OpenClaw WeChat

`GosperAI/openclaw-wechat` 是面向 Gosper 的 OpenClaw 微信 transport bridge 插件包。

它使用 OpenClaw/iLink 的微信 transport API 完成二维码登录、`getupdates` 轮询和 `sendmessage` 发送。它不会注册 OpenClaw channel runtime，也不会把微信消息送进 OpenClaw LLM 层。微信入站消息会直接进入 Gosper trigger，再交给 Gosper Supervisor。

完整使用手册见：[docs/usage.zh-CN.md](./docs/usage.zh-CN.md)。

最简单的部署方式不需要安装 OpenClaw CLI：

```bash
git clone https://github.com/GosperAI/openclaw-wechat.git
cd openclaw-wechat
npm install
npm run quickstart -- \
  --bridge-base-url https://wechat-bridge.example.com
```

这条命令会：

1. 生成 bridge host `.env`。
2. 打印需要填到 Gosper Vercel 的 env。
3. 执行 `docker compose up -d --build` 启动 bridge。

## 适合谁

- 使用 Gosper 公开生产地址的团队。
- 已经能访问 OpenClaw/iLink 微信 transport API 的团队。
- 希望用户在 Gosper 页面扫码绑定微信，并通过微信和 Gosper Supervisor 交互。
- 希望把微信 bridge 直接部署在 OpenClaw 所在常驻机器上。

不适合：

- 想把微信作为 OpenClaw channel 接入 OpenClaw LLM 的场景。
- 想在 Vercel Function 里跑微信长轮询的场景。

## 五分钟快速开始，不安装 OpenClaw

### 1. 克隆并安装

```bash
git clone https://github.com/GosperAI/openclaw-wechat.git
cd openclaw-wechat
npm install
```

### 2. 一键生成配置并启动 bridge

```bash
npm run quickstart -- \
  --bridge-base-url https://wechat-bridge.example.com
```

这会写入 bridge host `.env`，并输出一段 `Gosper Vercel env`。

Gosper 公开生产地址是内置默认值，不需要配置。只有自托管 Gosper 时才传 `--gosper-base-url`。

如果只想预览，不写文件、不启动 Docker：

```bash
npm run quickstart -- \
  --bridge-base-url https://wechat-bridge.example.com \
  --dry-run
```

如果只想写 `.env`，不启动 Docker：

```bash
npm run quickstart -- \
  --bridge-base-url https://wechat-bridge.example.com \
  --no-start
```

生成的配置分两段：

- `Bridge host env`：放到运行 bridge 的常驻主机。
- `Gosper Vercel env`：放到 Gosper 的 Vercel project。

两个 secret 必须成对一致：

| Bridge host | Gosper Vercel |
| --- | --- |
| `OPENCLAW_WECHAT_BRIDGE_TOKEN` | `GOSPER_WECHAT_TOOL_TOKEN` |
| `OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET` | `GOSPER_WECHAT_TRIGGER_SECRET` |

### 3. 在 OpenClaw 机器上运行 bridge

推荐把 bridge 部署在 OpenClaw 所在的常驻机器上。这样它天然靠近 OpenClaw/iLink transport 环境，也不会受 Vercel Function request duration 限制。

注意：部署在 OpenClaw 机器上，不等于注册成 OpenClaw channel runtime。这个服务仍然是旁路常驻 bridge，微信消息会回调 Gosper，而不是进入 OpenClaw LLM。

`quickstart` 默认已经通过 Docker Compose 启动。也可以手动启动：

```bash
npm run bridge
```

或：

```bash
docker compose -f deploy/compose.yaml --env-file .env up -d --build
```

生产要求：

- bridge 是常驻进程；
- bridge public URL 使用 HTTPS；
- `/data/openclaw-wechat` 是持久化 volume；
- `OPENCLAW_WECHAT_BRIDGE_STATE_SECRET` 已设置；
- `/healthz` 返回 `stateEncrypted: true`。

### 4. 配置 Gosper

在 Gosper Vercel project 设置：

```env
GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com
GOSPER_WECHAT_TOOL_TOKEN=<same as OPENCLAW_WECHAT_BRIDGE_TOKEN>
GOSPER_WECHAT_TRIGGER_SECRET=<same as OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET>
```

设置后重新部署 Gosper。

### 5. 验证

检查 bridge：

```bash
curl -sS https://wechat-bridge.example.com/healthz
```

预期：

```json
{
  "ok": true,
  "mode": "external_openclaw_transport",
  "channel": "openclaw-weixin",
  "stateEncrypted": true
}
```

用户验收：

1. 打开 Gosper Assistant。
2. 点击微信绑定。
3. 扫二维码。
4. 在微信里发一条真实消息。
5. 确认微信收到 Gosper Supervisor 回复。

## CLI

一键生成 `.env` 并启动 Docker Compose：

```bash
gosper-openclaw-wechat quickstart \
  --bridge-base-url https://wechat-bridge.example.com
```

生成配置：

```bash
gosper-openclaw-wechat env \
  --bridge-base-url https://wechat-bridge.example.com
```

自托管 Gosper 时覆盖默认生产地址：

```bash
gosper-openclaw-wechat quickstart \
  --bridge-base-url https://wechat-bridge.example.com \
  --gosper-base-url https://your-gosper.example.com
```

诊断 bridge host env：

```bash
gosper-openclaw-wechat doctor
gosper-openclaw-wechat doctor --json
```

启动 bridge：

```bash
gosper-openclaw-wechat start
```

查看 bridge runtime contract：

```bash
OPENCLAW_WECHAT_BRIDGE_TOKEN=bridge-token \
OPENCLAW_WECHAT_GOSPER_BASE_URL=https://gosper-ashen.vercel.app \
OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET=trigger-secret \
OPENCLAW_WECHAT_BRIDGE_STATE_SECRET=state-secret \
gosper-openclaw-wechat start --dry-run
```

## OpenClaw 插件安装

这一步是可选的。只运行 bridge 不需要安装 OpenClaw CLI。

在 OpenClaw 机器上，从本地 checkout 安装：

```bash
openclaw plugins install .
```

这个 package 有 `openclaw.plugin.json` 和 `package.json#openclaw`，所以 OpenClaw 可以识别它是 native plugin package。它没有 `channels` 字段，这是有意的。安装插件后，仍然需要把 bridge 作为常驻进程启动，例如 `gosper-openclaw-wechat start` 或 Docker Compose。

## 和 `@tencent-weixin/openclaw-weixin` 的区别

`@tencent-weixin/openclaw-weixin` 是 OpenClaw channel plugin，会把微信作为 OpenClaw channel 接入。

本项目是 Gosper transport bridge plugin package：

- 使用 iLink transport；
- 不声明 `channels`；
- 不走 OpenClaw LLM；
- 微信消息直接进入 Gosper Supervisor。
