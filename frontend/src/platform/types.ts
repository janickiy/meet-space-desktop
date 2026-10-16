import type { DesktopBridge, DesktopRuntimeInfo } from "./desktop-contracts";

export type { DesktopBridge, DesktopRuntimeInfo };

export interface PlatformAdapter {
  readonly kind: "web" | "desktop";
  getRuntimeInfo(): Promise<DesktopRuntimeInfo | null>;
  openExternal(url: string): Promise<void>;
  onRoute(handler: (route: string) => void): () => void;
  readonly windowControls?: Pick<
    DesktopBridge,
    "minimize" | "toggleMaximize" | "close"
  >;
}

declare global {
  interface Window {
    readonly meetspaceDesktop?: DesktopBridge;
  }
}
