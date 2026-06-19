# Gosper WeChat 连接配置说明

完整使用手册见：[usage.zh-CN.md](./usage.zh-CN.md)。

## 最小流程

1. 部署 `gosper-wechat` bridge 到常驻 host。
2. 给 bridge 配一个公网 HTTPS origin，例如 `https://wechat-bridge.example.com`。
3. 生成 bridge host env 和 Gosper Vercel env。
4. 在 Gosper Vercel project 写入 `GOSPER_WECHAT_*`。
5. 重新部署 Gosper。
6. 用户打开 Gosper Assistant，扫码绑定微信。
7. 用户发送微信消息，确认收到 Gosper Supervisor 回复。

## 生成 env

```bash
gosper-wechat env \
  --bridge-base-url https://wechat-bridge.example.com
```

Gosper 公开生产地址是默认值，不需要配置。自托管 Gosper 时才额外传：

```bash
--gosper-base-url https://your-gosper.example.com
```

## Bridge host env

```env
GOSPER_WECHAT_TOOL_TOKEN=<generated>
GOSPER_APP_BASE_URL=https://gosper-ashen.vercel.app
GOSPER_WECHAT_TRIGGER_SECRET=<generated>
GOSPER_WECHAT_BRIDGE_STATE_PATH=/data/gosper-wechat/state.json
GOSPER_WECHAT_BRIDGE_STATE_SECRET=<generated>
GOSPER_WECHAT_ILINK_BASE_URL=https://ilinkai.weixin.qq.com
GOSPER_WECHAT_BOT_TYPE=3
GOSPER_WECHAT_POLL_INTERVAL_MS=2000
GOSPER_WECHAT_LONG_POLL_TIMEOUT_MS=35000
```

## Gosper Vercel env

```env
GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com
GOSPER_WECHAT_TOOL_TOKEN=<same as bridge>
GOSPER_WECHAT_TRIGGER_SECRET=<same as bridge>
```

## bridge-base-url 是什么

`bridge-base-url` 是 bridge 服务的公网 HTTPS origin，不带 path。

正确：

```env
GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com
```

错误：

```env
GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com/v1/wechat/tools/execute
```
