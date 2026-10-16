// Test-only web transport stand-ins; the React hook and router are unchanged.
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { usePersonalRealtime } from "../src/personalRealtime";

const state = ((window as any).__webStage07 = {
  created: 0,
  closed: 0,
  tickets: 0,
  summaries: 0,
  active: new Set(),
});
class FixtureSocket extends EventTarget {
  static OPEN = 1;
  readyState = 0;
  bufferedAmount = 0;
  onopen: any;
  onclose: any;
  onmessage: any;
  onerror: any;
  constructor() {
    super();
    state.created++;
    state.active.add(this);
    queueMicrotask(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        this.onopen?.(new Event("open"));
      }
    });
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    state.closed++;
    state.active.delete(this);
    this.onclose?.(new CloseEvent("close", { code: 1000 }));
  }
  send() {}
}
(window as any).WebSocket = FixtureSocket;
window.fetch = async (input) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : input.toString(),
    location.href,
  );
  if (url.pathname.endsWith("/ws-ticket")) {
    state.tickets++;
    return Response.json({ ticket: "synthetic-web-fixture-ticket" });
  }
  if (url.pathname === "/api/v1/conversations") {
    state.summaries++;
    return Response.json({ items: [], nextCursor: null, unreadCount: 0 });
  }
  throw new Error("Unexpected request in the web regression fixture");
};
const queries = new QueryClient();
function Harness() {
  const [id, setId] = useState("11111111-1111-4111-8111-111111111111");
  const navigate = useNavigate();
  const location = useLocation();
  usePersonalRealtime(id);
  state.pathname = location.pathname;
  state.navigate = (route: string) => flushSync(() => navigate(route));
  state.setIdentity = (value: string) => flushSync(() => setId(value));
  return null;
}
const root = createRoot(document.getElementById("root")!);
root.render(
  createElement(
    QueryClientProvider,
    { client: queries },
    createElement(MemoryRouter, null, createElement(Harness)),
  ),
);
state.event = (event) => {
  for (const socket of state.active)
    socket.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(event) }),
    );
};
state.finish = () => {
  root.unmount();
  queries.clear();
};
