import fs from "node:fs";
import path from "node:path";

export interface StartupProvider {
  status(): { supported: boolean; enabled: boolean; reason?: "unpackaged" | "unavailable" | "conflict" };
  setEnabled(enabled: boolean): void;
}

export interface LinuxAutostartOptions {
  packaged: boolean;
  appId: string;
  execPath: string;
  env: Readonly<Record<string, string | undefined>>;
  homeDir: string;
  uid: number;
}

const ids = new Set(["com.janickiy.meetspace.desktop", "com.janickiy.meetspace.desktop.test"]);
const maximumEntrySize = 8192;
const unavailable = () => new Error("startup_unavailable");
const conflict = () => new Error("startup_conflict");
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
const noFollow = fs.constants.O_NOFOLLOW ?? 0;
const directoryFlag = fs.constants.O_DIRECTORY ?? 0;

function executableSyntax(value: string): boolean {
  return path.posix.isAbsolute(value) && !/[\u0000-\u001f\u007f=]/.test(value) && value.length <= 4096;
}

/** Desktop Entry escaping has two layers; this is not shell quoting.
 * https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html
 */
function execValue(value: string): string {
  if (!executableSyntax(value)) throw unavailable();
  const quoted = `"${value.replace(/%/g, "%%").replace(/["`$\\]/g, "\\$&")}"`;
  return quoted.replace(/\\/g, "\\\\");
}

function parseExec(value: string): string | null {
  if (!value.startsWith('"') || !value.endsWith('"')) return null;
  // Only the exact encoding emitted above is accepted, never field codes or args.
  const unescaped = value.replace(/\\\\/g, "\\");
  let result = "";
  for (let index = 1; index < unescaped.length - 1; index++) {
    const char = unescaped[index];
    if (char === "\\") {
      const next = unescaped[++index];
      if (!next || !'"`$\\'.includes(next)) return null;
      result += next;
    } else if (char === "%") {
      if (unescaped[++index] !== "%") return null;
      result += "%";
    } else if ('"`$'.includes(char)) return null;
    else result += char;
  }
  return executableSyntax(result) && execValue(result) === value ? result : null;
}

function desktopEntry(appId: string, executable: string, enabled: boolean): string {
  return `[Desktop Entry]\nType=Application\nName=${appId.endsWith(".test") ? "MeetSpace Test" : "MeetSpace"}\nExec=${execValue(executable)}\nTerminal=false\nHidden=${enabled ? "false" : "true"}\nX-MeetSpace-Autostart=1\nX-MeetSpace-AppId=${appId}\n`;
}

function parseEntry(appId: string, content: string): { executable: string; enabled: boolean } | null {
  const lines = content.split("\n");
  if (lines.length !== 9 || !lines[3].startsWith("Exec=")) return null;
  const executable = parseExec(lines[3].slice(5));
  const enabled = lines[5] === "Hidden=false";
  return executable && content === desktopEntry(appId, executable, enabled) ? { executable, enabled } : null;
}

function secureDirectory(stat: fs.Stats, uid: number, own: boolean): void {
  if (!stat.isDirectory() || (own ? stat.uid !== uid : stat.uid !== uid && stat.uid !== 0) ||
    ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0 && !own))) throw unavailable();
}

function ephemeral(value: string): boolean {
  // /var can be a symlink on development hosts; check both supplied and canonical paths.
  return ["/tmp", "/var/tmp", "/private/tmp", "/private/var/tmp", "/run", "/dev/fd", "/proc", "/sys"]
    .some(prefix => value === prefix || value.startsWith(`${prefix}/`));
}

function secureExecutable(filename: string, uid: number): string {
  // GLib 2.80 looks up Exec's argv[0] before expanding spec-correct %%.
  // A percent-bearing executable would register successfully but never start.
  // Reject just that target instead of using a shell/alias or invalid escaping.
  // https://github.com/GNOME/glib/blob/2.80.0/gio/gdesktopappinfo.c#L1791
  if (!executableSyntax(filename) || ephemeral(filename) || filename.includes("%")) throw unavailable();
  const resolved = fs.realpathSync(filename);
  if (ephemeral(resolved) || resolved.includes("%")) throw unavailable();
  const relative = path.posix.relative("/", resolved).split("/");
  let current = "/";
  secureDirectory(fs.lstatSync(current), uid, false);
  for (const component of relative.slice(0, -1)) {
    current = path.posix.join(current, component);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw unavailable();
    secureDirectory(stat, uid, false);
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || (stat.uid !== uid && stat.uid !== 0) || (stat.mode & 0o022) !== 0 || (stat.mode & 0o111) === 0) throw unavailable();
  fs.accessSync(resolved, fs.constants.X_OK);
  return resolved;
}

function launchTarget(options: LinuxAutostartOptions): string {
  if (!options.packaged || !ids.has(options.appId) || !Number.isSafeInteger(options.uid) || options.uid < 0 ||
    typeof process.getuid !== "function" || process.getuid() !== options.uid || !executableSyntax(options.homeDir)) throw unavailable();
  if (options.env.APPIMAGE !== undefined || options.env.APPDIR !== undefined) {
    // APPIMAGE is the stable original file; process.execPath is inside a transient mount.
    // https://docs.appimage.org/packaging-guide/environment-variables.html
    const image = options.env.APPIMAGE;
    const mount = options.env.APPDIR;
    if (!image || !mount || !executableSyntax(mount) || !executableSyntax(options.execPath)) throw unavailable();
    const target = secureExecutable(image, options.uid);
    const mountPath = fs.realpathSync(mount);
    const current = fs.realpathSync(options.execPath);
    const relative = path.posix.relative(mountPath, current);
    const stat = fs.statSync(current);
    if (!fs.statSync(mountPath).isDirectory() || !relative || relative.startsWith("../") || path.posix.isAbsolute(relative) ||
      !stat.isFile() || (stat.mode & 0o111) === 0) throw unavailable();
    return target;
  }
  // deb/rpm and unpacked packaged directories share an executable contract.
  // Do not infer package-manager ownership from a pathname.
  return secureExecutable(options.execPath, options.uid);
}

interface Directory { fd: number; pathname: string }
function child(directory: Directory, name: string): string {
  return process.platform === "linux" ? `/proc/self/fd/${directory.fd}/${name}` : path.join(directory.pathname, name);
}

/** Pin every Linux directory before following the next component. No recursive
 * mkdir, symlink traversal, shared daemon configuration, or permission changes.
 */
function withDirectory<T>(options: LinuxAutostartOptions, create: boolean, use: (directory: Directory | null) => T): T {
  const configured = options.env.XDG_CONFIG_HOME;
  const base = configured && path.posix.isAbsolute(configured) ? configured : path.posix.join(options.homeDir, ".config");
  if (!executableSyntax(base)) throw unavailable();
  const components = path.posix.join(base, "autostart").split("/").filter(Boolean);
  const descriptors: number[] = [];
  try {
    let directory = { fd: fs.openSync("/", fs.constants.O_RDONLY | directoryFlag | noFollow), pathname: "/" };
    descriptors.push(directory.fd);
    secureDirectory(fs.fstatSync(directory.fd), options.uid, false);
    for (let index = 0; index < components.length; index++) {
      const next = child(directory, components[index]);
      let fd: number;
      try { fd = fs.openSync(next, fs.constants.O_RDONLY | directoryFlag | noFollow); }
      catch (error) {
        if (!missing(error)) throw unavailable();
        if (!create) {
          fs.accessSync(process.platform === "linux" ? `/proc/self/fd/${directory.fd}` : directory.pathname, fs.constants.W_OK);
          return use(null);
        }
        try { fs.mkdirSync(next, { mode: 0o700 }); }
        catch (creationError) { if ((creationError as NodeJS.ErrnoException).code !== "EEXIST") throw creationError; }
        fd = fs.openSync(next, fs.constants.O_RDONLY | directoryFlag | noFollow);
      }
      descriptors.push(fd);
      secureDirectory(fs.fstatSync(fd), options.uid, index >= components.length - 2);
      directory = { fd, pathname: path.posix.join(directory.pathname, components[index]) };
    }
    return use(directory);
  } finally { for (const fd of descriptors.reverse()) fs.closeSync(fd); }
}

function ownFile(fd: number, uid: number): fs.Stats {
  const stat = fs.fstatSync(fd);
  if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o022) !== 0 || stat.size > maximumEntrySize) throw conflict();
  return stat;
}

function readEntry(directory: Directory, name: string, appId: string, uid: number): { fd: number; content: string; value: { executable: string; enabled: boolean } } | null {
  let fd: number;
  try {
    const initial = fs.lstatSync(child(directory, name));
    if (!initial.isFile() || initial.isSymbolicLink() || initial.uid !== uid || initial.nlink !== 1 ||
      (initial.mode & 0o022) !== 0 || initial.size > maximumEntrySize) throw conflict();
  } catch (error) { if (missing(error)) return null; throw error; }
  try { fd = fs.openSync(child(directory, name), fs.constants.O_RDWR | fs.constants.O_NONBLOCK | noFollow); }
  catch (error) {
    if (missing(error)) return null;
    if (["ELOOP", "EISDIR", "ENXIO"].includes((error as NodeJS.ErrnoException).code ?? "")) throw conflict();
    throw error;
  }
  try {
    ownFile(fd, uid);
    const bytes = Buffer.alloc(maximumEntrySize + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = fs.readSync(fd, bytes, size, bytes.length - size, size);
      if (!count) break;
      size += count;
    }
    if (size > maximumEntrySize) throw conflict();
    const content = bytes.subarray(0, size).toString("utf8");
    const value = parseEntry(appId, content);
    if (!value) throw conflict();
    return { fd, content, value };
  } catch (error) { fs.closeSync(fd); throw error; }
}

/** Runtime-only adapter. Construction/status never register anything. Native
 * callers supply validated build identity; renderer paths are never accepted.
 */
export function createLinuxAutostart(options: LinuxAutostartOptions): StartupProvider {
  const name = `${options.appId}.desktop`;
  return {
    status() {
      if (!options.packaged) return { supported: false, enabled: false, reason: "unpackaged" };
      try {
        const target = launchTarget(options);
        return withDirectory(options, false, directory => {
          if (!directory) return { supported: true, enabled: false };
          const entry = readEntry(directory, name, options.appId, options.uid);
          try { return { supported: true, enabled: !!entry && entry.value.enabled && entry.value.executable === target }; }
          finally { if (entry) fs.closeSync(entry.fd); }
        });
      } catch (error) { return { supported: false, enabled: false, reason: error instanceof Error && error.message === "startup_conflict" ? "conflict" : "unavailable" }; }
    },
    setEnabled(enabled) {
      if (typeof enabled !== "boolean") throw new Error("invalid_request");
      try {
        const target = launchTarget(options);
        withDirectory(options, true, directory => {
          if (!directory) throw unavailable();
          const entry = readEntry(directory, name, options.appId, options.uid);
          const content = desktopEntry(options.appId, !enabled && entry ? entry.value.executable : target, enabled);
          let fd = entry?.fd;
          try {
            if (entry?.content === content) return;
            if (fd === undefined) fd = fs.openSync(child(directory, name), fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow, 0o600);
            ownFile(fd, options.uid);
            // Write the checked inode, never rename over a potentially foreign replacement.
            fs.ftruncateSync(fd, 0);
            const bytes = Buffer.from(content, "utf8");
            let offset = 0;
            while (offset < bytes.length) {
              const count = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
              if (!count) throw new Error("preferences_unavailable");
              offset += count;
            }
            fs.fsyncSync(fd);
            const written = fs.fstatSync(fd);
            const current = fs.lstatSync(child(directory, name));
            if (current.isSymbolicLink() || written.dev !== current.dev || written.ino !== current.ino || current.nlink !== 1) throw conflict();
            const parent = fs.lstatSync(directory.pathname);
            const pinned = fs.fstatSync(directory.fd);
            if (parent.isSymbolicLink() || parent.dev !== pinned.dev || parent.ino !== pinned.ino ||
              fs.realpathSync(directory.pathname) !== directory.pathname) throw conflict();
          } finally { if (fd !== undefined) fs.closeSync(fd); }
        });
      } catch (error) {
        if (error instanceof Error && ["startup_unavailable", "startup_conflict"].includes(error.message)) throw error;
        if ((error as NodeJS.ErrnoException)?.code === "EEXIST") throw conflict();
        throw new Error("preferences_unavailable");
      }
    },
  };
}
