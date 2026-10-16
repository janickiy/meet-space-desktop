import { app, BrowserWindow } from "electron";
import { lstatSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const PREFIX = "--meetspace-desktop-acceptance=";
export const ACCEPTANCE_ROUTE = "/meetings/33333333-3333-4333-8333-333333333333/join";
export const ACCEPTANCE_LINK = `meetspace://open${ACCEPTANCE_ROUTE}`;
export type AcceptanceBuild = { releaseMode: unknown; trustedRelease: boolean; sourceCommit: string; version: string };

/** No renderer, output path, script, URL, or environment-variable override is accepted. */
export function acceptanceNonce(argv: readonly string[], build: AcceptanceBuild, packaged: boolean, platform: string): string | null {
  if (!packaged || platform !== "win32" || build.releaseMode !== "test" || build.trustedRelease ||
      !/^[a-f0-9]{40}$/.test(build.sourceCommit) || !/^\d+\.\d+\.\d+(?:-beta(?:\.\d+)?)?$/.test(build.version)) return null;
  const flags = argv.filter(value => value.startsWith("--meetspace-desktop-acceptance"));
  if (flags.length !== 1 || !flags[0].startsWith(PREFIX)) return null;
  const nonce = flags[0].slice(PREFIX.length);
  return /^[A-Za-z0-9_-]{43}$/.test(nonce) ? nonce : null;
}

function directory(value: string): void {
  mkdirSync(value, { recursive: true, mode: 0o700 });
  const stat = lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Acceptance directory is not safe");
}

/** Included only in unsigned test installers; release packaging excludes this module. */
export function prepareWindowsAcceptance(build: AcceptanceBuild): { run(window: BrowserWindow): Promise<void> } | null {
  const nonce = acceptanceNonce(process.argv, build, app.isPackaged, process.platform);
  if (!nonce) return null;
  const base = path.join(os.tmpdir(), "MeetSpaceAcceptance");
  const root = path.join(base, nonce);
  directory(base);
  directory(root);
  const profile = path.join(root, "profile");
  directory(profile);
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);
  let secondInstance = false;
  app.on("second-instance", (_event, argv) => {
    if (acceptanceNonce(argv, build, true, "win32") === nonce && argv.includes(ACCEPTANCE_LINK)) secondInstance = true;
  });
  const write = (name: string, data: unknown) => {
    const temporary = path.join(root, `${name}.tmp`);
    writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, path.join(root, name));
  };
  return { async run(window) {
    const checks: Record<string, boolean> = {};
    let completed = false;
    const finish = (result: "PASS" | "FAIL", failure?: string) => {
      if (completed) return;
      completed = true;
      clearTimeout(deadline);
      write("result.json", { schemaVersion: 1, sourceCommit: build.sourceCommit, version: build.version,
        testBuild: true, platform: process.platform, processArchitecture: process.arch, osRelease: os.release(),
        electron: process.versions.electron, pid: process.pid, result, checks, ...(failure ? { failure } : {}),
        collectedAt: new Date().toISOString() });
      app.quit();
    };
    const deadline = setTimeout(() => finish("FAIL", "acceptance_timeout"), 45000);
    try {
      // Electron exposes this diagnostic method at runtime, but omits it from its public typings.
      // It is used only by this excluded-from-release acceptance module and fails closed if removed.
      const diagnosticContents = window.webContents as typeof window.webContents & {
        getLastWebPreferences(): Record<string, unknown>;
      };
      const preferences = diagnosticContents.getLastWebPreferences();
      checks.sandbox = preferences.sandbox === true && preferences.contextIsolation === true &&
        preferences.nodeIntegration === false && preferences.webSecurity === true &&
        preferences.allowRunningInsecureContent !== true && preferences.webviewTag !== true && preferences.devTools === false;
      checks.localOrigin = window.webContents.getURL().startsWith("app://meetspace/");
      // These are fixed, local tests. No selected server, login, or backend request is created.
      const renderer = await window.webContents.executeJavaScript(`(async () => {
        const bridge = window.meetspaceDesktop;
        const runtime = await bridge.getRuntimeInfo();
        const state = await bridge.listServers();
        const preferences = await bridge.getNativePreferences();
        const response = await fetch('app://meetspace/');
        const csp = response.headers.get('content-security-policy') || '';
        window.__meetspaceAcceptanceInline = false;
        const script = document.createElement('script');
        script.textContent = 'window.__meetspaceAcceptanceInline = true';
        document.head.append(script); script.remove();
        window.__meetspaceAcceptanceRoute = null;
        bridge.onRoute(route => { window.__meetspaceAcceptanceRoute = route; });
        const denied = await fetch('app://meetspace/api/v1/auth/me');
        return { bridge: bridge.bridgeVersion === 5,
          isolated: typeof process === 'undefined' && typeof require === 'undefined',
          runtime: runtime.platform === 'win32' && runtime.isPackaged === true,
          arch: runtime.arch, version: runtime.appVersion,
          csp: csp.includes("default-src 'none'") && csp.includes("script-src 'self'") &&
            !csp.includes('unsafe-eval') && !csp.includes('unsafe-inline') && window.__meetspaceAcceptanceInline === false,
          localApiDenied: denied.status === 403, noServers: state.items.length === 0 && state.selectedId === null,
          noAutomaticStartup: preferences.startAtLogin === false };
      })()`);
      checks.bridge = renderer.bridge === true && renderer.isolated === true && renderer.runtime === true &&
        renderer.arch === process.arch && renderer.version === build.version;
      checks.csp = renderer.csp === true;
      checks.localApiDenied = renderer.localApiDenied === true;
      checks.noServers = renderer.noServers === true;
      checks.noAutomaticStartup = renderer.noAutomaticStartup === true;
      if (Object.values(checks).some(value => !value)) { finish("FAIL", "local_security_check_failed"); return; }
      write("ready.json", { schemaVersion: 1, pid: process.pid, sourceCommit: build.sourceCommit, version: build.version,
        platform: process.platform, processArchitecture: process.arch, testBuild: true });
      while (!completed && !secondInstance) await new Promise(resolve => setTimeout(resolve, 100));
      if (completed) return;
      // The existing main-process deep-link handler must deliver the route to the existing renderer.
      let route: unknown;
      for (let attempt = 0; attempt < 50 && !completed; attempt++) {
        route = await window.webContents.executeJavaScript("window.__meetspaceAcceptanceRoute");
        if (route === ACCEPTANCE_ROUTE) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (completed) return;
      checks.singleInstance = secondInstance && BrowserWindow.getAllWindows().length === 1;
      checks.deepLinkDelivery = route === ACCEPTANCE_ROUTE;
      finish(Object.values(checks).every(Boolean) ? "PASS" : "FAIL", Object.values(checks).every(Boolean) ? undefined : "single_instance_check_failed");
    } catch { finish("FAIL", "acceptance_runtime_failed"); }
  } };
}
