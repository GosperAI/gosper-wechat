# Gosper OpenClaw WeChat

OpenClaw WeChat transport bridge for Gosper.

This package is an OpenClaw native plugin package, but it intentionally does not register an OpenClaw channel runtime. It uses OpenClaw/iLink transport APIs for QR login, `getupdates`, and `sendmessage`, then delivers inbound WeChat messages directly to Gosper.

See [README.zh_CN.md](./README.zh_CN.md) for the current full setup guide.
