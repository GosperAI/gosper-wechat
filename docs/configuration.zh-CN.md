# OpenClaw WeChat 连接 Gosper 配置说明

## 最小流程

1. 部署 `openclaw-wechat` bridge 到常驻 host。
2. 生成 bridge host env 和 Gosper Vercel env。
3. 在 Gosper Vercel project 写入 `GOSPER_WECHAT_*`。
4. 重新部署 Gosper。
5. 用户打开 Gosper Assistant，扫码绑定微信。
6. 用户发送微信消息，确认收到 Gosper Supervisor 回复。

## 生成 env

```bash
gosper-openclaw-wechat env \
  --gosper-base-url https://gosper-ashen.vercel.app \
  --bridge-base-url https://wechat-bridge.example.com
```

## Bridge host env

```env
OPENCLAW_WECHAT_BRIDGE_TOKEN=<generated>
OPENCLAW_WECHAT_GOSPER_BASE_URL=https://gosper-ashen.vercel.app
OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET=<generated>
OPENCLAW_WECHAT_BRIDGE_STATE_PATH=/data/openclaw-wechat/state.json
OPENCLAW_WECHAT_BRIDGE_STATE_SECRET=<generated>
OPENCLAW_WECHAT_ILINK_BASE_URL=https://ilinkai.weixin.qq.com
```

## Gosper Vercel env

```env
GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com
GOSPER_WECHAT_TOOL_TOKEN=<same as OPENCLAW_WECHAT_BRIDGE_TOKEN>
GOSPER_WECHAT_TRIGGER_SECRET=<same as OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET>
GOSPER_APP_BASE_URL=https://gosper-ashen.vercel.app
```

## 不要配置 OpenClaw channel

这个项目不需要 `openclaw channels login --channel openclaw-weixin`。它不使用 OpenClaw channel runtime。
