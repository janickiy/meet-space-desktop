import { readFile, readdir, mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import runtimePolicy from './runtime-policy.cjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
async function installedPackage(from, name, optional = false) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error('Invalid dependency name');
  for (let current = from; ; current = path.dirname(current)) {
    const directory = path.join(current, 'node_modules', name);
    try { await readFile(path.join(directory, 'package.json')); return await realpath(directory); }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    if (path.dirname(current) === current) break;
  }
  if (optional) return null;
  throw new Error(`Required installed dependency is missing: ${name}`);
}

/** Conservative production closure, including installed peers, with full local license texts. */
export async function collectLicenseComponents(roots) {
  const components = new Map();
  async function visit(directory, scope, recurse, excluded = []) {
    const pkg = await json(path.join(directory, 'package.json'));
    const key = `${pkg.name}@${pkg.version}`;
    if (components.has(key)) { components.get(key).scopes.add(scope); return; }
    const files = (await readdir(directory)).filter(name => /^(licen[sc]e|copying|notice)(?:[._-].*)?$/i.test(name)).sort();
    const licenses = [];
    for (const filename of files) {
      const text = await readFile(path.join(directory, filename), 'utf8');
      if (!text.trim()) throw new Error(`Empty license for ${key}`);
      licenses.push({ filename, sha256: sha256(text), text });
    }
    if (!licenses.length) throw new Error(`No license text found for ${key}; distribution must stop for review`);
    components.set(key, { name: pkg.name, version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : 'SEE LICENSE TEXT',
      scopes: new Set([scope]), licenses });
    if (!recurse) return;
    const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
    const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...optional, ...Object.keys(pkg.peerDependencies ?? {})]);
    for (const name of [...names].sort()) {
      if (excluded.includes(name)) continue;
      const optionalPeer = Object.hasOwn(pkg.peerDependencies ?? {}, name) &&
        !Object.hasOwn(pkg.dependencies ?? {}, name) && pkg.peerDependenciesMeta?.[name]?.optional === true;
      const location = await installedPackage(directory, name, optional.has(name) || optionalPeer);
      if (location) await visit(location, scope, true, excluded);
    }
  }
  for (const root of roots) {
    const pkg = await json(path.join(root.directory, 'package.json'));
    if (root.packageOnly) await visit(root.directory, root.scope, false);
    else for (const name of Object.keys(pkg.dependencies ?? {}).sort())
      await visit(await installedPackage(root.directory, name), root.scope, true, root.excluded);
  }
  return [...components.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'))
    .map(component => ({ ...component, scopes: [...component.scopes].sort() }));
}

export async function generateNotices() {
  const desktop = fileURLToPath(new URL('..', import.meta.url));
  const frontend = path.resolve(desktop, '../frontend');
  const components = await collectLicenseComponents([
    { directory: frontend, scope: 'frontend production dependency closure (including installed peers)' },
    { directory: desktop, scope: 'shipped desktop JavaScript runtime (optional native accelerators excluded)', excluded: runtimePolicy.excludedOptionalPackages },
    // Vite injects its module-preload runtime helper into the bundled renderer.
    { directory: path.join(frontend, 'node_modules/vite'), scope: 'bundled renderer build helper', packageOnly: true },
  ]);
  const qrLicenseFilename = 'frontend/src/vendor/LICENSE';
  const qrLicense = await readFile(path.join(frontend, 'src/vendor/LICENSE'), 'utf8');
  if (!qrLicense.trim()) throw new Error('Empty license for vendored Nayuki QR generator');
  components.push({
    name: 'nayuki-qr-code-generator',
    version: 'git-3c6d0b3cefb4e049dc337e82237c9644399716a8',
    license: 'MIT',
    scopes: ['vendored offline renderer QR generator'],
    licenses: [{ filename: qrLicenseFilename, sha256: sha256(qrLicense), text: qrLicense }],
  });
  components.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
  const header = 'MEETSPACE — THIRD-PARTY NOTICES\n\n' +
    'This file reproduces licenses from the installed, lockfile-pinned dependencies and vendored components.\n' +
    'MeetSpace application code and supplied branding are not licensed by this file.\n' +
    'The application package is UNLICENSED; distribution rights require owner approval.\n' +
    'The conservative dependency inventory may include installed type-only peers.\n' +
    'Electron and Chromium notices are shipped separately as LICENSE.electron.txt and LICENSES.chromium.html.\n\n';
  const text = header + components.map(item => `${'='.repeat(72)}\n${item.name}@${item.version} (${item.license})\n${item.scopes.join('; ')}\n\n` +
    item.licenses.map(license => `--- ${license.filename} ---\n${license.text.trimEnd()}\n`).join('\n')).join('\n');
  const manifest = { schemaVersion: 1, applicationLicense: 'UNLICENSED', inventory: 'actual installed production closure plus Vite injected helper and vendored QR generator; conservative installed peers included',
    lockfiles: { frontend: sha256(await readFile(path.join(frontend, 'package-lock.json'))), desktop: sha256(await readFile(path.join(desktop, 'package-lock.json'))) },
    noticesSha256: sha256(text), separateNotices: ['LICENSE.electron.txt', 'LICENSES.chromium.html'],
    components: components.map(item => ({ ...item, licenses: item.licenses.map(({ text: _text, ...license }) => license) })) };
  const resources = path.join(desktop, 'resources');
  await mkdir(resources, { recursive: true });
  await writeFile(path.join(resources, 'THIRD_PARTY_NOTICES.txt'), text);
  await writeFile(path.join(resources, 'third-party-licenses.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('This generator accepts no arguments');
  const manifest = await generateNotices();
  console.log(`Generated third-party notices for ${manifest.components.length} installed components.`);
}
