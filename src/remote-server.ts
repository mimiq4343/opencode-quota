import { Plugin } from "@opencode/plugin";

/** The remote deployment entrypoint must never initialize collectors on a Desktop Mac. */
export default Plugin.define({
  id: "@slkiser/opencode-quota.server",
  async setup(ctx) {
    if (process.platform !== "linux") {
      throw new Error("Install the GUI-only Desktop package here; quota collection requires Linux");
    }
    const { default: server } = await import("./plugin.js");
    return server.setup(ctx);
  },
});
