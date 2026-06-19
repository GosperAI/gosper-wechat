# Gosper WeChat

`GosperAI/gosper-wechat` 是面向 Gosper 的独立微信 bridge。

它作为常驻 Node.js 服务运行，负责微信扫码登录、`getupdates` 轮询收消息、`sendmessage` 发消息。微信入站消息会直接回调 Gosper trigger，再交给 Gosper Supervisor。

一个团队只需要部署一个 `gosper-wechat` bridge。每个 Gosper 用户发起绑定时，Gosper 会把 `organizationId/userId` 放进 bridge context；bridge 会按这个 owner scope 保存 bot token、cursor 和 context token，出站回复也只会在同一个用户 scope 内选择微信账号。

完整使用手册见：[docs/usage.zh-CN.md](./docs/usage.zh-CN.md)。

## 五分钟快速开始

```bash
git clone https://github.com/GosperAI/gosper-wechat.git
cd gosper-wechat
npm install
npm run quickstart -- \
  --bridge-base-url https://wechat-bridge.example.com
```

这条命令会：

1. 生成 bridge host `.env`。
2. 打印需要填到 Gosper Vercel 的 env。
3. 执行 `docker compose up -d --build` 启动 bridge。

Gosper 公开生产地址是内置默认值，不需要配置。只有自托管 Gosper 时才传 `--gosper-base-url`。

## 适合谁

- 使用 Gosper 公开生产地址的团队。
- 已经能访问 iLink 微信 transport API 的团队。
- 希望用户在 Gosper 页面扫码绑定微信，并通过微信和 Gosper Supervisor 交互。
- 希望一个团队部署一个 bridge，但团队内每个用户绑定自己的 Gosper 账号。
- 有一台可以长期运行 bridge 的主机。

不适合：

- 想在 Vercel Function 里跑微信长轮询的场景。
- 没有公网 HTTPS bridge 地址的场景。

## 配置关系

生成的配置分两段：

- `Bridge host env`：放到运行 bridge 的常驻主机。
- `Gosper Vercel env`：放到 Gosper 的 Vercel project。

两个 secret 必须成对一致：

| Bridge host | Gosper Vercel |
| --- | --- |
| `GOSPER_WECHAT_TOOL_TOKEN` | `GOSPER_WECHAT_TOOL_TOKEN` |
| `GOSPER_WECHAT_TRIGGER_SECRET` | `GOSPER_WECHAT_TRIGGER_SECRET` |

`GOSPER_APP_BASE_URL` 是 bridge 回调 Gosper 的地址。CLI 默认写入 Gosper 公开生产地址；自托管时才需要覆盖。

## 常驻运行

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
- `/data/gosper-wechat` 是持久化 volume；
- `GOSPER_WECHAT_BRIDGE_STATE_SECRET` 已设置；
- `/healthz` 返回 `stateEncrypted: true`。

## 配置 Gosper

在 Gosper Vercel project 设置：

```env
GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com
GOSPER_WECHAT_TOOL_TOKEN=<same as bridge>
GOSPER_WECHAT_TRIGGER_SECRET=<same as bridge>
```

设置后重新部署 Gosper。

## 验证

检查 bridge：

```bash
curl -sS https://wechat-bridge.example.com/healthz
```

预期：

```json
{
  "ok": true,
  "mode": "gosper_wechat_transport",
  "transport": "ilink-wechat",
  "accounts": 0,
  "owners": 0,
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
gosper-wechat quickstart \
  --bridge-base-url https://wechat-bridge.example.com
```

生成配置：

```bash
gosper-wechat env \
  --bridge-base-url https://wechat-bridge.example.com
```

自托管 Gosper 时覆盖默认生产地址：

```bash
gosper-wechat quickstart \
  --bridge-base-url https://wechat-bridge.example.com \
  --gosper-base-url https://your-gosper.example.com
```

诊断 bridge host env：

```bash
gosper-wechat doctor
gosper-wechat doctor --json
```

启动 bridge：

```bash
gosper-wechat start
```

查看 bridge runtime contract：

```bash
GOSPER_WECHAT_TOOL_TOKEN=bridge-token \
GOSPER_APP_BASE_URL=https://gosper-ashen.vercel.app \
GOSPER_WECHAT_TRIGGER_SECRET=trigger-secret \
GOSPER_WECHAT_BRIDGE_STATE_SECRET=state-secret \
gosper-wechat start --dry-run
```
