import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

describe("remote deployment packages", () => {
  it("rejects a Desktop Mac before initializing the server collector", () => {
    const entry = new URL("../dist/remote-server.js", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      Object.defineProperty(process, "platform", { value: "darwin" });
      const { default: plugin } = await import(${JSON.stringify(entry)});
      await plugin.setup({});
    `,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("quota collection requires Linux");
  });

  it("ships a GUI-only Desktop package without a server entrypoint or collectors", async () => {
    const output = await mkdtemp(join(tmpdir(), "quota-packages-"));
    try {
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL("../.github/scripts/package-remote.mjs", import.meta.url)), output],
        { encoding: "utf8" },
      );
      expect({ code: result.status, error: result.stderr }).toEqual({ code: 0, error: "" });
      const desktop = join(output, "desktop");
      const manifest = JSON.parse(await readFile(join(desktop, "package.json"), "utf8"));
      expect(manifest.name).toBe("@mimiq4343/opencode-quota-desktop");
      expect(manifest.exports).toEqual({ "./gui-experimental": "./gui-experimental.cjs" });
      expect(manifest).not.toHaveProperty("main");
      expect(manifest).not.toHaveProperty("dependencies");
      expect((await readdir(desktop)).sort()).toEqual([
        "LICENSE",
        "README.md",
        "gui-experimental.cjs",
        "package.json",
      ]);
      const server = JSON.parse(await readFile(join(output, "server", "package.json"), "utf8"));
      expect(server.name).toBe("@mimiq4343/opencode-quota-server");
      expect(server.exports["./gui-experimental"]).toBeUndefined();
      expect(server.exports["."].default).toBe("./dist/remote-server.js");
      expect(await readFile(join(output, "server", "dist", "remote-server.js"), "utf8")).toContain(
        "linux",
      );
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  });
});
