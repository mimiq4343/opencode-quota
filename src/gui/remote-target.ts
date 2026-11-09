import type { Context, MountedSession } from "@opencode/plugin/gui";
import type { GuiQuotaHost } from "./bridge.js";

type RemoteHost = Pick<Context, "options" | "servers">;
type Server = NonNullable<ReturnType<Context["servers"]["get"]>>;
type Session = Pick<MountedSession, "id" | "directory" | "server">;
type Client = ReturnType<GuiQuotaHost["client"]>;

/** A configured native connection, never the Desktop sidecar or the selected server. */
export function remoteQuotaTarget(host: RemoteHost) {
  const serverId = host.options.remoteServerId;
  const directory = host.options.remoteDirectory;
  const configurationError =
    typeof serverId !== "string" || !serverId.trim()
      ? "Set remoteServerId to the existing remote OpenCode connection ID"
      : typeof directory !== "string" || !directory.startsWith("/")
        ? "Set remoteDirectory to an absolute directory on the remote server"
        : undefined;

  function connection(): Server {
    if (configurationError) throw new Error(configurationError);
    const server = host.servers.get(serverId as string);
    if (!server) throw new Error("The configured remote quota server is unavailable");
    if (server.builtin || server.local)
      throw new Error("The Desktop sidecar cannot collect remote quota");
    if (!server.compatible) throw new Error("The remote quota server has an incompatible version");
    if (!server.connected) throw new Error("The remote quota server is disconnected");
    return server;
  }

  // A stable failing transport lets the existing quota client report failures and reconnect.
  // It contains no provider code, credentials, HTTP client, or local fallback.
  let problem: unknown;
  let active: Server["client"] | undefined;
  let transport: Client | undefined;
  let generation = 0;
  const unavailable: Client = {
    rpc() {
      throw problem;
    },
  };
  const owns = (session: Pick<Session, "server" | "id"> | undefined) =>
    !configurationError &&
    !!session &&
    !session.server.builtin &&
    !session.server.local &&
    !host.servers.get(serverId as string)?.local &&
    session.server.id === serverId;

  function guarded(native: Server["client"]): Client {
    const at = generation;
    const current = () => {
      try {
        return at === generation && connection().client === native;
      } catch {
        return false;
      }
    };
    const assertCurrent = () => {
      if (!current())
        throw new Error("Remote quota connection changed while the request was in flight");
    };
    return {
      rpc(definition) {
        assertCurrent();
        const port = (native as unknown as Client).rpc(definition);
        return new Proxy(port, {
          get(object, key) {
            if (key === "events")
              return {
                on(
                  name: "changed",
                  handler: Parameters<typeof port.events.on>[1],
                  options?: { signal?: AbortSignal },
                ) {
                  assertCurrent();
                  return port.events.on(
                    name,
                    (event) => {
                      if (current()) handler(event);
                    },
                    options,
                  );
                },
              };
            const method = Reflect.get(object, key);
            if (typeof method !== "function") return method;
            return async (...args: unknown[]) => {
              assertCurrent();
              const result = await method.apply(object, args);
              assertCurrent();
              return result;
            };
          },
        });
      },
    };
  }

  return {
    client(): Client {
      try {
        const native = connection().client;
        if (native !== active) {
          active = native;
          generation += 1;
          transport = guarded(native);
        }
        return transport!;
      } catch (error) {
        if (active) generation += 1;
        active = undefined;
        transport = undefined;
        problem = error;
        return unavailable;
      }
    },
    server(): Server | undefined {
      try {
        return connection();
      } catch {
        // Calls through client() report the same failure in the quota UI.
        return undefined;
      }
    },
    owns,
    directoryOf: (session: Session | undefined): string | undefined =>
      owns(session) ? session!.directory : configurationError ? undefined : (directory as string),
    sessionIDOf: (session: Session | undefined) => (owns(session) ? session!.id : undefined),
  };
}
