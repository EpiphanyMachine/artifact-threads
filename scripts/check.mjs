import { readFile, readdir, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("extension/manifest.json", root)),
);
for (const file of await readdir(new URL("extension/", root)))
  if (file.endsWith(".js"))
    execFileSync(process.execPath, [
      "--check",
      new URL("extension/" + file, root).pathname,
    ]);
for (const file of [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...manifest.sandbox.pages,
  ...Object.values(manifest.icons || {}),
])
  await access(new URL("extension/" + file, root));
if (manifest.content_scripts || manifest.externally_connectable)
  throw new Error("Review unexpected external access.");
const runtime = (
  await Promise.all(
    (await readdir(new URL("extension/", root)))
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFile(new URL("extension/" + f, root), "utf8")),
  )
).join("\n");
if (/client_secret\s*[:=]|private_key\s*[:=]/.test(runtime))
  throw new Error("Secrets do not belong in a public extension.");
console.log("Syntax, manifest entrypoints, and credential boundary checked.");
