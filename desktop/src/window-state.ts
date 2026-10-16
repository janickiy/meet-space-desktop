import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface Rectangle { x: number; y: number; width: number; height: number }
export interface WindowState { bounds: Rectangle; maximized: boolean }
export interface LocalPreferences { closeToTray: boolean; nativeNotifications: boolean }
const defaults: LocalPreferences = { closeToTray: false, nativeNotifications: true };
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function rectangle(value: unknown): value is Rectangle {
  if (!value || typeof value !== "object") return false;
  const item = value as Rectangle;
  return [item.x, item.y, item.width, item.height].every(number) &&
    Math.abs(item.x) <= 100000 && Math.abs(item.y) <= 100000 &&
    item.width >= 200 && item.height >= 200 && item.width <= 20000 && item.height <= 20000;
}

/** Work areas and saved bounds are device-independent pixels, including negative monitor origins. */
export function restoreWindowState(saved: WindowState | null, areas: Rectangle[], primary: Rectangle): WindowState {
  const displays = areas.filter(rectangle);
  if (!displays.length) displays.push(primary);
  const requested = saved && rectangle(saved.bounds) ? saved.bounds : null;
  const overlap = (area: Rectangle) => requested ?
    Math.max(0, Math.min(area.x + area.width, requested.x + requested.width) - Math.max(area.x, requested.x)) *
    Math.max(0, Math.min(area.y + area.height, requested.y + requested.height) - Math.max(area.y, requested.y)) : 0;
  const best = displays.reduce((winner, area) => overlap(area) > overlap(winner) ? area : winner, displays[0]);
  const area = requested && overlap(best) > 0 ? best : primary;
  const width = Math.round(Math.min(area.width, Math.max(Math.min(900, area.width), requested?.width ?? 1280)));
  const height = Math.round(Math.min(area.height, Math.max(Math.min(640, area.height), requested?.height ?? 850)));
  const x = requested && overlap(best) > 0 ? requested.x : area.x + (area.width - width) / 2;
  const y = requested && overlap(best) > 0 ? requested.y : area.y + (area.height - height) / 2;
  return { bounds: { width, height, x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))) }, maximized: saved?.maximized === true };
}

/** Only geometry and local toggles are persisted; no routes, identities or content. */
export class DesktopLocalState {
  private readonly filename: string;
  private window: WindowState | null = null;
  private preferences: LocalPreferences = { ...defaults };
  constructor(directory: string) {
    this.filename = path.join(directory, "desktop-state.json");
    try {
      if (fs.statSync(this.filename).size > 4096) return;
      const value = JSON.parse(fs.readFileSync(this.filename, "utf8"));
      if (value?.version !== 1) return;
      if (rectangle(value.window?.bounds) && typeof value.window?.maximized === "boolean")
        this.window = { bounds: { x: value.window.bounds.x, y: value.window.bounds.y, width: value.window.bounds.width, height: value.window.bounds.height }, maximized: value.window.maximized };
      for (const key of ["closeToTray", "nativeNotifications"] as const)
        if (typeof value.preferences?.[key] === "boolean") this.preferences[key] = value.preferences[key];
    } catch { /* Missing or malformed nonsecret preferences use defaults. */ }
  }
  windowState(): WindowState | null { return this.window ? { bounds: { ...this.window.bounds }, maximized: this.window.maximized } : null; }
  getPreferences(): LocalPreferences { return { ...this.preferences }; }
  setWindow(value: WindowState): void {
    if (!rectangle(value.bounds) || typeof value.maximized !== "boolean") return;
    this.window = { bounds: { ...value.bounds }, maximized: value.maximized };
    this.save();
  }
  updatePreferences(input: unknown): LocalPreferences {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      !Object.keys(input).length || Object.keys(input).some(key => !["closeToTray", "nativeNotifications"].includes(key)) ||
      Object.values(input).some(value => typeof value !== "boolean")) throw new Error("invalid_request");
    const previous = this.preferences;
    this.preferences = { ...previous, ...input };
    try { this.save(); } catch (error) { this.preferences = previous; throw error; }
    return this.getPreferences();
  }
  private save(): void {
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, window: this.window, preferences: this.preferences }), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, this.filename);
    } catch {
      try { fs.unlinkSync(temporary); } catch { /* No temporary file remains when possible. */ }
      throw new Error("preferences_unavailable");
    }
  }
}
