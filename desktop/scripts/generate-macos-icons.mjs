// Optional resource regeneration on macOS; not part of normal builds.
// Supply a local Sharp module path without adding a runtime/build dependency:
// node scripts/generate-macos-icons.mjs /absolute/path/to/node_modules/sharp
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

if (process.platform !== "darwin" || process.argv.length !== 3 || !path.isAbsolute(process.argv[2]))
  throw new Error("Use generate-macos-icons.mjs <absolute-local-Sharp-module-path> on macOS");
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2]);
const desktop = fileURLToPath(new URL("..", import.meta.url));
const source = await readFile(path.join(desktop, "resources/icon.svg"));
const sourceHash = createHash("sha256").update(source).digest("hex");
const original = JSON.parse(await readFile(path.join(desktop, "resources/icon-source.json"), "utf8"));
// Reuse only the approved brand resource, with no raster enlargement.
if (sourceHash !== original.sourceSHA256) throw new Error("Brand source changed; review icon-source.json before regenerating");
const output = path.join(desktop, "resources/macos");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), "meetspace-macos-icons-"));
try {
  const iconset = path.join(temporary, "MeetSpace.iconset");
  await mkdir(iconset);
  for (const logical of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = logical * scale;
      await sharp(source, { density: Math.max(72, pixels / 512 * 72) }).resize(pixels, pixels)
        .png().toFile(path.join(iconset, `icon_${logical}x${logical}${scale === 2 ? "@2x" : ""}.png`));
    }
  }
  const result = spawnSync("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", path.join(output, "icon.icns")], { stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error("Cannot generate macOS ICNS");
  const marks = source.toString().match(/<g id="mark-white">[\s\S]*?<\/g>/g);
  if (marks?.length !== 1) throw new Error("Expected one approved monochrome brand mark");
  const tray = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="-18 -13 236 236">${marks[0].replaceAll('fill="#FFF"', 'fill="#000"')}</svg>\n`;
  await writeFile(path.join(output, "TrayTemplate.svg"), tray);
  for (const scale of [1, 2]) await sharp(Buffer.from(tray), { density: 72 * scale })
    .resize(18 * scale, 18 * scale).png().toFile(path.join(output, `TrayTemplate${scale === 2 ? "@2x" : ""}.png`));
  const files = {};
  for (const name of ["icon.icns", "TrayTemplate.svg", "TrayTemplate.png", "TrayTemplate@2x.png"])
    files[name] = createHash("sha256").update(await readFile(path.join(output, name))).digest("hex");
  await writeFile(path.join(output, "source.json"), JSON.stringify({
    source: "../icon.svg", sourceSha256: sourceHash,
    generator: "scripts/generate-macos-icons.mjs", sharpVersion: sharp.versions.sharp,
    applicationIcon: "Original approved app mark, rendered at each 1x/2x size from SVG",
    trayIcon: "Approved mark-white silhouette, black on transparency; 18px/36px template pair",
    files,
  }, null, 2) + "\n");
} finally { await rm(temporary, { recursive: true, force: true }); }
