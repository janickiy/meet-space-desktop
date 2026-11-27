import { useMemo, useSyncExternalStore } from "react";
import { serviceOrigin } from "./platform/urls";

type ThreadKind = "conversation" | "conference";
const prefix = "meetspace.hidden-messages.v1/";
const listeners = new Set<() => void>();
let revision = 0;

function changed() {
  revision++;
  listeners.forEach((notify) => notify());
}

function storageChanged(event: StorageEvent) {
  if (event.key === null || event.key.startsWith(prefix)) changed();
}

function subscribe(notify: () => void) {
  if (!listeners.size) window.addEventListener("storage", storageChanged);
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
    if (!listeners.size) window.removeEventListener("storage", storageChanged);
  };
}

function readHidden(scope: string | null) {
  const ids = new Set<string>();
  if (!scope) return ids;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(scope)) continue;
      const batch: unknown = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(batch)) {
        for (const id of batch) if (typeof id === "string") ids.add(id);
      }
    }
  } catch {
    // Storage can be unavailable in a restricted browser session.
  }
  return ids;
}

/** Each selection is one atomic local write. Concurrent windows can append independently. */
export function useHiddenChatMessages(
  userId: string | undefined,
  kind: ThreadKind,
  threadId: string,
) {
  const scope = userId
    ? prefix +
      [serviceOrigin(), userId, kind, threadId]
        .map(encodeURIComponent)
        .join("/") +
      "/"
    : null;
  const version = useSyncExternalStore(subscribe, () => revision);
  const hidden = useMemo(() => readHidden(scope), [scope, version]);

  function hide(ids: string[]) {
    if (!scope || !ids.length) return;
    localStorage.setItem(scope + crypto.randomUUID(), JSON.stringify(ids));
    changed();
  }
  return { hidden, hide };
}
