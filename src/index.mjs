const plugin = {
  id: "gosper-openclaw-wechat",
  name: "Gosper OpenClaw WeChat",
  description:
    "OpenClaw WeChat transport bridge for Gosper. Runtime messages are delivered to Gosper, not to an OpenClaw channel.",
  register(api) {
    if (typeof api?.registerTool !== "function") return;
    api.registerTool({
      name: "gosper_wechat_bridge_config",
      description:
        "Return the Gosper WeChat bridge configuration contract and setup checklist.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {}
      },
      async execute() {
        return {
          content: [
            {
              type: "text",
              text: [
                "Gosper OpenClaw WeChat uses external_openclaw_transport.",
                "Run `gosper-openclaw-wechat env --gosper-base-url <url> --bridge-base-url <url>` to generate matching env.",
                "Run `gosper-openclaw-wechat start` or deploy deploy/compose.yaml to start the resident bridge.",
                "This plugin does not register an OpenClaw channel runtime."
              ].join("\n")
            }
          ]
        };
      }
    });
  }
};

export default plugin;
