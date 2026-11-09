// Creates separate deployment trees; the Desktop package contains no server code or dependencies.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(process.argv[2] ?? join(root, "package-artifacts/remote"));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
await mkdir(output, { recursive: true });

for (const role of ["desktop", "server"]) {
  const directory = join(output, role);
  await mkdir(directory); // Never overwrite a previous deployment tree.
  const common = {
    name: `@mimiq4343/opencode-quota-${role}`,
    version: manifest.version,
    private: true,
    type: "module",
    license: "MIT",
    repository: "https://github.com/mimiq4343/opencode-quota",
  };
  const entry =
    role === "desktop"
      ? { exports: { "./gui-experimental": "./gui-experimental.cjs" } }
      : {
          exports: {
            ".": { types: "./dist/remote-server.d.ts", default: "./dist/remote-server.js" },
            "./tui": manifest.exports["./tui"],
          },
          dependencies: manifest.dependencies,
          peerDependencies: manifest.peerDependencies,
          peerDependenciesMeta: manifest.peerDependenciesMeta,
        };
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ ...common, ...entry }, null, 2) + "\n",
  );
  await cp(join(root, "LICENSE"), join(directory, "LICENSE"));
  await cp(join(root, "docs/readme/remote-desktop.md"), join(directory, "README.md"));
  if (role === "desktop") {
    await cp(join(root, "dist/gui-experimental.cjs"), join(directory, "gui-experimental.cjs"));
  } else {
    await cp(join(root, "dist"), join(directory, "dist"), {
      recursive: true,
      filter: (source) => !source.endsWith("gui-experimental.cjs"),
    });
  }
}
