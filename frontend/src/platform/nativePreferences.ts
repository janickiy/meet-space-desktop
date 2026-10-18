import type {
  DesktopBridge,
  DesktopNativePreferences,
} from "./desktop-contracts";

type PreferenceInput = Parameters<DesktopBridge["setNativePreferences"]>[0];

/** Serializes the existing native methods; a stale read cannot undo a newer user intent. */
export function createNativePreferencesController(
  bridge: Pick<DesktopBridge, "getNativePreferences" | "setNativePreferences">,
  observer: {
    value(value: DesktopNativePreferences): void;
    error(error: unknown): void;
    busy(busy: boolean): void;
  },
) {
  let disposed = false;
  let running = false;
  let refreshPending = false;
  let revision = 0;
  const updates: { input: PreferenceInput; revision: number }[] = [];

  async function drain() {
    if (running || disposed) return;
    running = true;
    try {
      while (!disposed && (updates.length || refreshPending)) {
        const update = updates.shift();
        if (!update) refreshPending = false;
        const current = update?.revision ?? revision;
        try {
          const value = await (update
            ? bridge.setNativePreferences(update.input)
            : bridge.getNativePreferences());
          if (!disposed && current === revision) observer.value(value);
        } catch (error) {
          if (!disposed && current === revision) observer.error(error);
        }
        if (!disposed && !updates.length) observer.busy(false);
      }
    } finally {
      running = false;
    }
  }

  return {
    refresh() {
      if (disposed) return;
      refreshPending = true;
      void drain();
    },
    update(input: PreferenceInput) {
      if (disposed) return;
      updates.push({ input, revision: ++revision });
      observer.busy(true);
      void drain();
    },
    dispose() {
      disposed = true;
      refreshPending = false;
      updates.length = 0;
    },
  };
}

/** Poll only a visible settings page, including a fresh read after returning to it. */
export function watchNativePreferences(
  refresh: () => void,
  page: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >,
  host: Pick<
    Window,
    "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval"
  >,
) {
  let timer: number | undefined;
  const visible = () => page.visibilityState === "visible";
  const onFocus = () => {
    if (visible()) refresh();
  };
  const onVisibility = () => {
    if (timer !== undefined) host.clearInterval(timer);
    timer = undefined;
    if (visible()) {
      refresh();
      timer = host.setInterval(onFocus, 5_000);
    }
  };
  host.addEventListener("focus", onFocus);
  page.addEventListener("visibilitychange", onVisibility);
  onVisibility();
  return () => {
    host.removeEventListener("focus", onFocus);
    page.removeEventListener("visibilitychange", onVisibility);
    if (timer !== undefined) host.clearInterval(timer);
  };
}
