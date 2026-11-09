# 2026-11-09 — Remote-only Desktop fork

The user approved a public GitHub fork of `slkiser/opencode-quota`, maintained on demand
when integration breaks rather than automatically synchronized with upstream.
The baseline is `afc5f5b2ef20f60851797c977e1577cd65773489` (package 6.2.2).

Provider collection and credentials must stay on the remote Linux OpenCode server.
Desktop receives a separate GUI-only package and uses one explicitly configured native
connection, never the sidecar or whichever server a local session happens to select.
See the [deployment guide](../../docs/readme/remote-desktop.md) for the maintained contract.
The generated `desktop/` shipping tree is versioned and tested against the built GUI
bundle so Homebrew installs the Mac UI without a Node or pnpm dependency graph.
Private connection settings and credentials must never enter this public repository.

On this date the untouched upstream `tests/settings.test.ts` suite reproduced a timeout in
`watchSettings > sees an edit of a symlinked file's target, which only the stat poll notices`
under Linux Node 26.13.0. An archived baseline with the same locked dependencies failed
the same way; running that single test alone passed. No upstream watcher fix was included.
This is a dated baseline observation, not a statement about later environments or CI.
