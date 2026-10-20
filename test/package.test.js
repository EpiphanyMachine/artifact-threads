import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
test("release ZIP excludes scratch files, includes notices, and rejects symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "artifact-package-"));
  try {
    for (const name of ["extension", "scripts", "LICENSE", "PRIVACY.md"])
      await cp(new URL("../" + name, import.meta.url), join(dir, name), { recursive: true });
    await writeFile(join(dir, "extension", "private-note.txt"), "synthetic private scratch");
    execFileSync("python3", [join(dir, "scripts/package.py")]);
    const names = JSON.parse(execFileSync("python3", ["-c", "import zipfile,json,sys; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))", join(dir, "dist/artifact-threads-0.2.0.zip")], { encoding: "utf8" }));
    assert.ok(names.includes("LICENSE") && names.includes("PRIVACY.md") && names.includes("manifest.json"));
    assert.equal(names.includes("private-note.txt"), false);
    await rm(join(dir, "extension/app-config.js"));
    await symlink(join(dir, "LICENSE"), join(dir, "extension/app-config.js"));
    assert.throws(() => execFileSync("python3", [join(dir, "scripts/package.py")], { stdio: "pipe" }), /Unsafe or missing release input/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
