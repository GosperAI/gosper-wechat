# Gosper OpenClaw WeChat 使用说明

本文说明如何从零部署 `GosperAI/openclaw-wechat`，让用户可以在 Gosper 页面扫码绑定微信，并通过微信和 Gosper Supervisor 交互。

主路径不需要安装 OpenClaw CLI。你可以直接在 OpenClaw 所在机器上运行 `quickstart`，让它生成 `.env` 并启动 Docker Compose。

## 1. 最终链路

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

这个项目只使用 OpenClaw/iLink transport，不使用 OpenClaw channel runtime，不经过 OpenClaw LLM 层。

## 2. 前置条件

你需要准备：

| 项 | 要求 |
| --- | --- |
| Gosper 生产地址 | 默认使用公开生产地址 `https://gosper-ashen.vercel.app`，不需要用户配置。自托管 Gosper 时才需要覆盖。 |
| Bridge 公网地址 | 公网 HTTPS，例如 `https://wechat-bridge.example.com`。 |
| 常驻 host | 推荐直接使用 OpenClaw 所在机器；Fly、Railway、Render、ECS、VM 也可以。不要使用 Vercel Function。 |
| OpenClaw/iLink 访问能力 | 默认 iLink 地址是 `https://ilinkai.weixin.qq.com`。 |
| Node.js | 本地运行需要 Node.js 20+。 |
| Docker | 容器部署时需要 Docker 和 Docker Compose。 |

## 3. 克隆项目

```bash
git clone https://github.com/GosperAI/openclaw-wechat.git
cd openclaw-wechat
npm install
```

检查：

```bash
npm test
```

## 4. 一键启动，不安装 OpenClaw

运行：

```bash
npm run quickstart -- \
  --bridge-base-url https://wechat-bridge.example.com
```

它会做三件事：

1. 在项目根目录写入 `.env`。
2. 在终端打印 `Gosper Vercel env`。
3. 执行 `docker compose -f deploy/compose.yaml --env-file .env up -d --build`。

只预览，不写文件、不启动 Docker：

```bash
npm run quickstart -- \
  --bridge-base-url https://wechat-bridge.example.com \
  --dry-run
```

只写 `.env`，不启动 Docker：

```bash
npm run quickstart -- \
  --bridge-base-url https://wechat-bridge.example.com \
  --no-start
```

如果 `.env` 已存在并且你确认要覆盖：

```bash
npm run quickstart -- \
  --bridge-base-url https://wechat-bridge.example.com \
  --force
```

如果你不是连接 Gosper 公开生产环境，而是连接自托管 Gosper，再额外传：

```bash
--gosper-base-url https://your-gosper.example.com
```

## 5. 手动生成配置

运行：

```bash
node bin/gosper-openclaw-wechat.mjs env \
  --bridge-base-url https://wechat-bridge.example.com
```

输出示例结构：

```env
# Bridge host env
OPENCLAW_WECHAT_BRIDGE_TOKEN=<generated>
OPENCLAW_WECHAT_GOSPER_BASE_URL=https://gosper-ashen.vercel.app
OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET=<generated>
OPENCLAW_WECHAT_BRIDGE_STATE_PATH=/data/openclaw-wechat/state.json
OPENCLAW_WECHAT_BRIDGE_STATE_SECRET=<generated>
OPENCLAW_WECHAT_ILINK_BASE_URL=https://ilinkai.weixin.qq.com
OPENCLAW_WECHAT_BOT_TYPE=3
OPENCLAW_WECHAT_POLL_INTERVAL_MS=2000
OPENCLAW_WECHAT_LONG_POLL_TIMEOUT_MS=35000

# Gosper Vercel env
GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com
GOSPER_WECHAT_TOOL_TOKEN=<same as OPENCLAW_WECHAT_BRIDGE_TOKEN>
GOSPER_WECHAT_TRIGGER_SECRET=<same as OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET>
```

不要提交这些 secret。

## 6. 手动部署 bridge

推荐部署位置是 OpenClaw 所在机器。

原因：

- 这台机器通常已经具备 OpenClaw/iLink transport 的网络环境；
- bridge 需要常驻轮询 iLink `getupdates`；
- bridge 需要持久化保存 bot token、cursor 和 context token；
- Gosper 在 Vercel 上只需要被回调，不需要承担常驻连接。

注意：bridge 部署在 OpenClaw 机器上，并不表示它会进入 OpenClaw channel runtime。它仍然是一个旁路常驻服务，负责把微信 transport 转发给 Gosper。

### 6.1 Docker Compose 部署

创建 `.env`：

```bash
cp env.example .env
```

把第 4 步输出的 `Bridge host env` 填到 `.env`。

启动：

```bash
docker compose -f deploy/compose.yaml --env-file .env up -d --build
```

查看日志：

```bash
docker compose -f deploy/compose.yaml logs -f openclaw-wechat
```

停止：

```bash
docker compose -f deploy/compose.yaml down
```

### 6.2 Node 直接运行

把 `Bridge host env` 导入当前 shell，然后运行：

```bash
npm run bridge
```

或者：

```bash
node bin/gosper-openclaw-wechat.mjs start
```

### 6.3 生产部署要求

生产环境必须满足：

- bridge 是常驻进程；
- bridge public URL 是 HTTPS；
- `/data/openclaw-wechat` 是持久化 volume；
- `OPENCLAW_WECHAT_BRIDGE_STATE_SECRET` 已配置；
- 不开启 plaintext state；
- 不把 `.env` 提交到 Git。

## 7. 配置 Gosper

在 Gosper Vercel project 里设置：

```env
GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com
GOSPER_WECHAT_TOOL_TOKEN=<same as OPENCLAW_WECHAT_BRIDGE_TOKEN>
GOSPER_WECHAT_TRIGGER_SECRET=<same as OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET>
```

使用 Vercel CLI 时：

```bash
vercel env add GOSPER_WECHAT_TOOL_BASE_URL production
vercel env add GOSPER_WECHAT_TOOL_TOKEN production
vercel env add GOSPER_WECHAT_TRIGGER_SECRET production
```

重新部署 Gosper：

```bash
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod --yes
```

## 8. 健康检查

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
  "accounts": 0,
  "stateEncrypted": true
}
```

本机诊断：

```bash
node bin/gosper-openclaw-wechat.mjs doctor
node bin/gosper-openclaw-wechat.mjs doctor --json
```

查看 runtime contract：

```bash
OPENCLAW_WECHAT_BRIDGE_TOKEN=bridge-token \
OPENCLAW_WECHAT_GOSPER_BASE_URL=https://gosper-ashen.vercel.app \
OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET=trigger-secret \
OPENCLAW_WECHAT_BRIDGE_STATE_SECRET=state-secret \
node bin/gosper-openclaw-wechat.mjs start --dry-run
```

## 9. 用户绑定流程

用户侧：

1. 打开 Gosper Assistant。
2. 点击微信绑定入口。
3. 扫描二维码。
4. 等待页面显示 connected。
5. 在微信里发送一条真实消息。
6. 确认收到 Gosper Supervisor 回复。

系统侧：

1. Gosper 调用 bridge `create_bind_session`。
2. Bridge 调用 iLink `get_bot_qrcode`。
3. Gosper 页面轮询 bind session。
4. Bridge 调用 iLink `get_qrcode_status`。
5. Bridge 绑定成功后回调 Gosper `/api/tools/triggers/wechat/bind`。
6. Bridge 通过 iLink `getupdates` 收到微信消息。
7. Bridge 回调 Gosper `/api/tools/triggers/wechat`。
8. Gosper Supervisor 回复。
9. Gosper 调用 bridge `/v1/wechat/tools/execute`。
10. Bridge 调用 iLink `sendmessage` 发回微信。

## 10. Gosper probe 验收

在 Gosper repo 中运行：

```bash
npm run wechat:probe -- \
  --bridge-base-url "$GOSPER_WECHAT_TOOL_BASE_URL" \
  --callback-base-url https://gosper-ashen.vercel.app \
  --show-qr \
  --wait-connected \
  --send-after-connected \
  --wait-supervisor-interaction \
  --output ./evidence/wechat-probe-current.json
```

通过时应看到：

```text
ok: true
supervisorInteraction.ok: true
supervisorInteraction.supervisorStatus: replied
supervisorInteraction.supervisorDeliveryOk: true
```

## 11. OpenClaw 插件安装，可选

只启动 bridge 不需要安装 OpenClaw CLI。本节只用于希望 OpenClaw 控制面能识别这个 package 的场景。

在 OpenClaw 机器上，从本地 checkout 安装：

```bash
openclaw plugins install .
```

或发布到 npm 后安装：

```bash
openclaw plugins install @gosper/openclaw-wechat
```

注意：

- 这个 package 是 native OpenClaw plugin package。
- 它有 `openclaw.plugin.json` 和 `package.json#openclaw`。
- 它没有 `channels` 字段。
- 不需要执行 `openclaw channels login --channel openclaw-weixin`。
- 安装插件不等于启动 bridge；bridge 仍然需要作为常驻服务运行。

## 12. 常见问题

### 12.1 `GOSPER_WECHAT_TOOL_BASE_URL` 填什么？

填 bridge 的公网 HTTPS origin，不要带 path。

正确：

```env
GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com
```

错误：

```env
GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com/v1/wechat/tools/execute
```

### 12.2 token 从哪里来？

自己生成。推荐用 CLI 的 `env` 命令生成。

`OPENCLAW_WECHAT_BRIDGE_TOKEN` 必须等于 `GOSPER_WECHAT_TOOL_TOKEN`。

`OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET` 必须等于 `GOSPER_WECHAT_TRIGGER_SECRET`。

### 12.3 可以不安装 OpenClaw 吗？

可以。推荐主路径就是不安装 OpenClaw CLI，直接运行：

```bash
npm run quickstart -- \
  --bridge-base-url https://wechat-bridge.example.com
```

它会生成 `.env` 并启动 Docker Compose。

### 12.4 可以把 bridge 跑在 Vercel Function 吗？

不建议。bridge 需要常驻轮询 iLink `getupdates`，应该跑在支持常驻进程的 host 上。

### 12.5 二维码过期怎么办？

重新创建 bind session，让用户扫描新二维码。不要复用旧截图。

### 12.6 微信没有收到回复怎么办？

按顺序检查：

1. `curl https://wechat-bridge.example.com/healthz` 是否 `ok: true`。
2. `stateEncrypted` 是否 `true`。
3. Gosper Vercel env 是否配置完整。
4. 两组 shared secret 是否完全一致。
5. bridge 日志里是否有 iLink `getupdates` 错误。
6. Gosper trigger 是否返回 `supervisor.status: replied`。
7. 最近微信会话是否有可用 `context_token`。

### 12.7 它和 `@tencent-weixin/openclaw-weixin` 是什么关系？

`@tencent-weixin/openclaw-weixin` 是 OpenClaw channel plugin。

`@gosper/openclaw-wechat` 是 Gosper transport bridge plugin package。它只用 iLink transport，不走 OpenClaw channel runtime，不走 OpenClaw LLM。
