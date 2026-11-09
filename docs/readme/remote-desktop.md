# Remote-only Desktop fork

This is a maintained fork of [slkiser/opencode-quota](https://github.com/slkiser/opencode-quota),
based on 6.2.2, commit `afc5f5b2ef20f60851797c977e1577cd65773489`.
Upstream's MIT license and attribution remain unchanged. Upstream updates are reviewed and
integrated when needed, not merged or installed automatically.

## Deployment model

- A Linux OpenCode server owns provider credentials, quota collection, storage and the quota RPC.
- Desktop loads a separate GUI-only package with no server entrypoint, collectors or runtime dependencies.
- All GUI RPC calls use one explicitly configured, existing native server connection. There is no
  sidecar fallback, provider login in the GUI, SSH wrapper, new listener or credential transfer.
- Home and local/other-server sessions show the pinned remote account quotas. Their IDs and paths
  are never sent to that server. Session-specific tokens and cost apply only to sessions on the
  pinned server.
- A disconnected or missing connection reports an error and keeps the last in-memory snapshot
  marked stale. A reconnect uses the new client and drops in-flight answers from the old one.

This is an application-level separation, not an operating-system firewall or a general guarantee
about other applications' network traffic. The configured native connection must lead to the
intended remote machine; a loopback URL may legitimately be an existing SSH tunnel.

## Build

Use the pnpm version in `package.json` and the checked-in lockfile:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm test
node .github/scripts/package-remote.mjs /absolute/path/to/new-output
```

The output directory contains `desktop/` and `server/`. Existing role directories are never
overwritten. These are local deployment packages, not npm publications. Keep their code at the
same fork commit. The main source package preserves upstream's development/build arrangement;
**do not install that full package on the Desktop Mac**.

The Linux deployment package needs the root lockfile's production dependencies supplied by its
package manager. The Desktop package needs none. In a Homebrew-managed environment, build and
install these trees through a pinned formula rather than installing the Git checkout as a runtime.

## Configure

On Linux, add the installed `server/` directory to the global OpenCode `plugins` list. Its guarded
entrypoint rejects non-Linux systems before importing the collector. Existing provider logins stay
on Linux; this fork does not create or copy them. Provider support and collection behavior otherwise
remain upstream's. In particular, configure only the providers you want, and review upstream's
credential refresh behavior before deployment.

On Desktop, add only the installed `desktop/` directory to global `opencode.json(c)`:

```jsonc
{
  "plugins": [{
    "package": "/absolute/path/to/installed/desktop",
    "options": {
      "remoteServerId": "YOUR_EXISTING_NATIVE_SERVER_ID",
      "remoteDirectory": "/absolute/remote/project"
    }
  }]
}
```

Both options are required. Use the native connection's exact ID, not a server name. Private URLs,
passwords, machine-specific IDs and paths belong in local configuration, never this public fork.
The builtin Desktop sidecar and its local HTTP aliases are explicitly rejected. Missing, disconnected and incompatible targets
fail closed. Changing the selected session never changes this binding.

The quota side tab, bottom strip, Quota dialog and settings page use the remote server. Settings
save on Linux. To inspect fresh limits, use Refresh in the Quota dialog. The remote server must
load the matching server package in the configured directory and in any VM session directories.

## Verification and maintenance

Run `pnpm run build` before bundle/package tests. `tests/gui.remote-target.test.ts` covers Home,
local and foreign-server isolation, all RPC operations, invalid bindings, missing connections,
disconnect and reconnect. The bundle tests check actual Desktop contributions. Package tests
verify that the Desktop deployment cannot expose a server entrypoint.

The target version is Desktop/OpenCode 2.2.6; the upstream SDK dependency is 2.2.5. Automated tests
do not establish that a particular user's Desktop connection, login or proxy route works. Verify
those on the target hosts before declaring an installation operational. The upstream unofficial
side-panel resizing helper remains; it now also follows remote session panels and may need review
when Desktop markup changes.
