import type { Context, MountedSession } from "@opencode/plugin/gui";
import { describe, expect, it, vi } from "vite-plus/test";
import type { QuotaSnapshot } from "../src/core/types.js";
import { createGuiQuota } from "../src/gui/bridge.js";
import { remoteQuotaTarget } from "../src/gui/remote-target.js";

function fixture(
  options: Record<string, unknown> = {
    remoteServerId: "remote-vm",
    remoteDirectory: "/projects",
  },
) {
  let revision = 1;
  const snapshot = (): QuotaSnapshot => ({
    version: 6,
    providers: [],
    resetNotices: [],
    generatedAtMs: Date.now(),
    serverId: "remote-process",
    revision,
  });
  const rpc = {
    snapshot: vi.fn(async () => ({ snapshot: snapshot() })),
    refresh: vi.fn(async () => ({ snapshot: snapshot() })),
    usage: vi.fn(async () => ({ report: { range: "7d", remote: true } })),
    settings: vi.fn(async () => ({ values: {} })),
    saveSettings: vi.fn(async () => ({ ok: true, issues: [] })),
    settingsSchema: vi.fn(async () => ({ settings: [] })),
    status: vi.fn(async () => ({ text: "Remote quota status" })),
    noticeList: vi.fn(async () => ({ notices: [] })),
    events: { on: vi.fn(() => () => {}) },
  };
  const localRpc = vi.fn(() => {
    throw new Error("Local quota collection is forbidden");
  });
  const remote = {
    id: "remote-vm",
    name: "Remote",
    builtin: false,
    local: false,
    connected: true,
    compatible: true,
    client: { rpc: () => rpc },
  };
  let available = true;
  const host = {
    options,
    client: { rpc: localRpc },
    servers: {
      get: (id: string) =>
        id === "sidecar"
          ? { ...remote, id: "sidecar", builtin: true, client: { rpc: localRpc } }
          : id === "remote-vm" && available
            ? remote
            : undefined,
    },
  } as unknown as Context;
  const target = remoteQuotaTarget(host);
  const data = createGuiQuota({
    client: target.client,
    directory: () => target.directoryOf(undefined),
  });
  return {
    target,
    data,
    remote,
    rpc,
    localRpc,
    session: (id: string) =>
      ({
        id: "ses_shared",
        directory: id === "remote-vm" ? "/projects/chat" : "/private/local",
        server: { id, builtin: id === "sidecar" },
      }) as MountedSession,
    disappear: () => {
      available = false;
    },
    advance: () => {
      revision += 1;
    },
  };
}

describe("remote-only Desktop quota", () => {
  it("rejects an HTTP alias of the local sidecar, including its session IDs", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.remote.local = true;
    const stop = f.data.watch("/projects");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.data.snapshot("/projects")).toBeUndefined();
    expect(f.target.sessionIDOf(f.session("remote-vm"))).toBeUndefined();
    expect(f.rpc.snapshot).not.toHaveBeenCalled();
    stop();
  });

  it("drops a snapshot from a replaced client even before the reconnect poll", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let release!: (value: unknown) => void;
    f.rpc.snapshot.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }) as never,
    );
    const stop = f.data.watch("/projects");
    const second = fixture();
    f.remote.client = second.remote.client;
    const stopSecond = f.data.watch("/projects");
    release({
      snapshot: {
        version: 6,
        providers: [],
        resetNotices: [],
        generatedAtMs: Date.now(),
        serverId: "old-client",
        revision: 10,
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.data.snapshot("/projects")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.data.snapshot("/projects")?.serverId).toBe("remote-process");
    stopSecond();
    stop();
  });

  it("rejects a settings reply from a client replaced while the RPC was in flight", async () => {
    const f = fixture();
    let release!: (value: unknown) => void;
    f.rpc.settings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }) as never,
    );
    const loading = f.data.settings();
    f.remote.client = fixture().remote.client;
    release({ values: { stale: true } });
    await expect(loading).rejects.toThrow("connection changed");
  });

  it("ignores events from the old connection before and after the reconnect poll", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const stop = f.data.watch("/projects");
    await vi.advanceTimersByTimeAsync(0);
    const listener = f.rpc.events.on.mock.calls[0]?.[1] as unknown as (event: unknown) => void;
    f.remote.client = fixture().remote.client;
    const stale = {
      location: { directory: "/projects" },
      data: {
        snapshot: {
          version: 6,
          providers: [],
          resetNotices: [],
          generatedAtMs: Date.now(),
          serverId: "stale-events",
          revision: 99,
        },
      },
    };
    listener(stale);
    expect(f.data.snapshot("/projects")?.serverId).toBe("remote-process");
    await vi.advanceTimersByTimeAsync(5_000);
    listener(stale);
    expect(f.data.snapshot("/projects")?.serverId).toBe("remote-process");
    stop();
  });

  it.each(["sidecar", "another-server", undefined])(
    "never forwards the session or path of %s to the VM",
    async (id) => {
      vi.useFakeTimers();
      const f = fixture();
      const session = id ? f.session(id) : undefined;
      expect(f.target.sessionIDOf(session)).toBeUndefined();
      expect(f.target.directoryOf(session)).toBe("/projects");
      const stop = f.data.watch(f.target.directoryOf(session), f.target.sessionIDOf(session));
      await vi.advanceTimersByTimeAsync(0);
      expect(f.data.snapshot("/projects")?.serverId).toBe("remote-process");
      expect(f.rpc.snapshot.mock.calls[0]).toEqual([
        {},
        { location: { directory: "/projects" }, signal: expect.any(AbortSignal) },
      ]);
      expect(f.localRpc).not.toHaveBeenCalled();
      stop();
    },
  );

  it("scopes VM sessions to their own directory and ID", () => {
    const f = fixture();
    expect(f.target.directoryOf(f.session("remote-vm"))).toBe("/projects/chat");
    expect(f.target.sessionIDOf(f.session("remote-vm"))).toBe("ses_shared");
  });

  it.each([
    [{}, "remoteServerId"],
    [{ remoteServerId: "remote-vm" }, "remoteDirectory"],
    [{ remoteServerId: "remote-vm", remoteDirectory: "relative" }, "absolute"],
    [{ remoteServerId: "sidecar", remoteDirectory: "/projects" }, "sidecar"],
    [{ remoteServerId: "missing", remoteDirectory: "/projects" }, "unavailable"],
  ])("fails closed for invalid binding %j", async (options, message) => {
    vi.useFakeTimers();
    const f = fixture(options);
    const stop = f.data.watch(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.data.snapshot(undefined)).toBeUndefined();
    expect(f.data.failure(undefined)).toMatchObject({
      kind: "error",
      message: expect.stringContaining(message),
    });
    expect(f.localRpc).not.toHaveBeenCalled();
    expect(f.rpc.snapshot).not.toHaveBeenCalled();
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the VM for refresh, settings, diagnostics and reports, not just snapshots", async () => {
    const f = fixture();
    await f.data.refresh("/projects");
    expect(await f.data.settings()).toEqual({ values: {} });
    expect(await f.data.saveSettings({ patch: {} })).toEqual({ ok: true, issues: [] });
    expect(await f.data.settingsSchema()).toEqual({ settings: [] });
    expect(await f.data.status()).toBe("Remote quota status");
    expect(await f.data.notices()).toEqual([]);
    expect(await f.data.usage({ range: "7d" }, "/projects")).toEqual({ range: "7d", remote: true });
    expect(f.localRpc).not.toHaveBeenCalled();
    for (const method of [
      f.rpc.refresh,
      f.rpc.settings,
      f.rpc.saveSettings,
      f.rpc.settingsSchema,
      f.rpc.status,
      f.rpc.noticeList,
      f.rpc.usage,
    ]) {
      expect(method.mock.calls[0]?.[1]).toMatchObject({ location: { directory: "/projects" } });
    }
  });

  it("keeps the last reading marked failed while disconnected, then reconnects to the VM", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const stop = f.data.watch("/projects");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.data.snapshot("/projects")?.revision).toBe(1);
    f.remote.connected = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.data.snapshot("/projects")?.revision).toBe(1);
    expect(f.data.failure("/projects")).toMatchObject({
      kind: "error",
      message: expect.stringContaining("disconnected"),
    });
    f.advance();
    f.remote.connected = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.data.snapshot("/projects")?.revision).toBe(2);
    expect(f.data.failure("/projects")).toBeUndefined();
    expect(f.localRpc).not.toHaveBeenCalled();
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not fall back when the pinned connection is removed", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.disappear();
    const stop = f.data.watch("/projects");
    await vi.advanceTimersByTimeAsync(65_000);
    expect(f.data.failure("/projects")).toMatchObject({ kind: "error" });
    expect(f.localRpc).not.toHaveBeenCalled();
    expect(f.rpc.snapshot).not.toHaveBeenCalled();
    stop();
  });
});
