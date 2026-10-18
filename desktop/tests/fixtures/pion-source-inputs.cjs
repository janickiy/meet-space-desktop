// Test evidence only. The desktop snapshot does not include Go production files.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function backendSourceInputs(repository) {
  const names = ["go.mod", "go.sum", "desktop/tests/fixtures/pion-sfu/main.go"];
  async function walk(directory) {
    for (const entry of await fs.readdir(path.join(repository, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile() && entry.name.endsWith(".go")) names.push(name);
      else if (entry.isSymbolicLink()) throw new Error("Go source evidence cannot follow symlinks");
    }
  }
  await walk("internal");
  const files = [];
  for (const name of [...new Set(names)].sort()) {
    const bytes = await fs.readFile(path.join(repository, name));
    files.push({ path: name, sha256: sha256(bytes), bytes: bytes.length });
  }
  return {
    schemaVersion: 1,
    scope: "go.mod, go.sum, test Pion driver and every internal/*.go source (including tests); production SFU is imported unchanged",
    sourceTreeSha256: sha256(JSON.stringify(files)),
    files,
  };
}
module.exports = { backendSourceInputs, sha256 };
