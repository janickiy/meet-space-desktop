import { createContext, useContext, type ReactNode } from "react";
import type { DesktopRuntimeInfo } from "./desktop-contracts";

const RuntimeContext = createContext<DesktopRuntimeInfo | null>(null);

/** Presentation capabilities come from the validated native bridge, never the user agent. */
export function DesktopRuntimeProvider({
  value,
  children,
}: {
  value: DesktopRuntimeInfo | null;
  children: ReactNode;
}) {
  return (
    <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
  );
}

export function useDesktopRuntime() {
  return useContext(RuntimeContext);
}

export function useWorkspaceShortcut() {
  const runtime = useDesktopRuntime();
  const macOS = runtime?.platform === "darwin";
  return {
    label: macOS ? "⌘ K" : "Ctrl K",
    ariaKeyShortcuts: macOS ? "Meta+K" : "Control+K",
    macOS,
  };
}
