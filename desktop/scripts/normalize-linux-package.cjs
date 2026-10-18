const {
  chmod, copyFile, lstat, lutimes, readFile, readdir, readlink, realpath,
  rename, rm, utimes,
} = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

module.exports = async ({ appOutDir, electronPlatformName }) => {
  if (process.platform !== "linux" || electronPlatformName !== "linux")
    throw new Error("Linux package normalization requires a Linux target");
  const provenance = JSON.parse(await readFile(
    path.join(__dirname, "../dist/build-provenance.json"), "utf8",
  ));
  const epoch = provenance.sourceDateEpoch;
  if (provenance.releaseMode !== "test" || !Number.isSafeInteger(epoch) || epoch < 315532800)
    throw new Error("Missing Linux test package provenance");
  const root = await realpath(appOutDir);
  const contains = (filename) => filename === root || filename.startsWith(root + path.sep);
  const normalize = async (directory) => {
    for (const item of (await readdir(directory)).sort()) {
      const filename = path.join(directory, item);
      const info = await lstat(filename);
      if (info.isSymbolicLink()) {
        const target = await readlink(filename);
        if (path.isAbsolute(target) || !contains(path.resolve(directory, target)) || !contains(await realpath(filename)))
          throw new Error("Linux package symlink escapes the application payload");
        await lutimes(filename, epoch, epoch);
      } else if (info.isDirectory()) {
        await normalize(filename);
      } else if (info.isFile()) {
        // Builder may hardlink its cache. Never chmod/retime that shared inode.
        if (info.nlink > 1) {
          const temporary = `${filename}.meetspace-${randomUUID()}.tmp`;
          try {
            await copyFile(filename, temporary);
            await rename(temporary, filename);
          } finally { await rm(temporary, { force: true }); }
        }
        const sandbox = filename === path.join(root, "chrome-sandbox");
        await chmod(filename, sandbox ? 0o4755 : ((info.mode & 0o111) ? 0o755 : 0o644));
        await utimes(filename, epoch, epoch);
      } else {
        throw new Error("Unsupported file type in Linux package");
      }
    }
    await chmod(directory, 0o755);
    await utimes(directory, epoch, epoch);
  };
  await normalize(root);
  const sandbox = await lstat(path.join(root, "chrome-sandbox"));
  if (!sandbox.isFile() || sandbox.isSymbolicLink() || (sandbox.mode & 0o7777) !== 0o4755)
    throw new Error("The packaged Chromium sandbox must be a regular 4755 file");
};
