import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DesktopServerProfile } from "../shared/contracts";
import { normalizeServerOrigin } from "../network/policy";
import { atomicWrite } from "../session/vault";

export class ServerProfiles {
  items: DesktopServerProfile[] = [];
  selectedId: string | null = null;
  private readonly filename: string;
  constructor(storageDir: string) { this.filename = path.join(storageDir, "servers.json"); }
  async load(): Promise<void> {
    try {
      const content = await readFile(this.filename, "utf8");
      if (content.length > 64 * 1024) throw new Error();
      const value = JSON.parse(content);
      if (!Array.isArray(value.items) || value.items.length > 20) throw new Error();
      this.items = value.items.map((item: DesktopServerProfile) => {
        const origin = normalizeServerOrigin(item.origin);
        if (item.id !== this.id(origin) || typeof item.label !== "string" || item.label.length > 80 || /[\u0000-\u001f]/.test(item.label)) throw new Error();
        return { id: item.id, origin, label: item.label, version: typeof item.version === "string" ? item.version.slice(0, 100) : undefined,
          commit: typeof item.commit === "string" ? item.commit.slice(0, 64) : undefined,
          lastCheckedAt: typeof item.lastCheckedAt === "string" ? item.lastCheckedAt.slice(0, 40) : undefined };
      });
      this.selectedId = this.items.some((item) => item.id === value.selectedId) ? value.selectedId : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("server_profiles_corrupt");
    }
  }
  id(origin: string): string { return createHash("sha256").update(origin).digest("hex").slice(0, 32); }
  selected(): DesktopServerProfile {
    const profile = this.items.find((item) => item.id === this.selectedId);
    if (!profile) throw new Error("server_not_selected");
    return profile;
  }
  async save(): Promise<void> {
    await atomicWrite(this.filename, JSON.stringify({ items: this.items, selectedId: this.selectedId }));
  }
}
