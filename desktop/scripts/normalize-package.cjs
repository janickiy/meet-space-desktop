const { readdir, utimes } = require("node:fs/promises");
const path = require("node:path");
module.exports = async ({ appOutDir }) => {
  const provenance = require(
    path.join(__dirname, "../dist/build-provenance.json"),
  );
  const epoch = provenance.sourceDateEpoch;
  if (!Number.isSafeInteger(epoch) || epoch < 315532800)
    throw new Error("Missing deterministic source epoch");
  const normalize = async (directory) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, item.name);
      if (item.isSymbolicLink())
        throw new Error("Unexpected symlink in Windows package");
      if (item.isDirectory()) await normalize(filename);
      await utimes(filename, epoch, epoch);
    }
    await utimes(directory, epoch, epoch);
  };
  await normalize(appOutDir);
};
