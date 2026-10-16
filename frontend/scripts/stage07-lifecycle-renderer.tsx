// Test entry only. Existing production modules are imported without replacements.
import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { AuthProvider, useAuth } from "../src/auth";
import { MessageThread } from "../src/components/ChatPanel";
import { personalChatAPI } from "../src/api";
import { usePersonalRealtime } from "../src/personalRealtime";
import { ConferenceMediaClient } from "../src/media";

const scope = "55555555-5555-4555-8555-555555555555";
const state = (window as any).__stage07;
const queries = new QueryClient();
let toggle: (value: boolean) => void;
let root: ReturnType<typeof createRoot>;
let media: ConferenceMediaClient | null = null;

function Chat() {
  const { user } = useAuth();
  usePersonalRealtime(user?.id);
  useEffect(() => {
    state.chatMounted = true;
    return () => {
      state.chatMounted = false;
    };
  }, []);
  return createElement(MessageThread, {
    scopeId: scope,
    transport: personalChatAPI,
    personal: true,
    readOnly: false,
  });
}
function Harness() {
  const { user, loading, login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  toggle = setVisible;
  state.navigate = (route: string) => flushSync(() => navigate(route));
  state.login = login;
  state.logout = logout;
  state.pathname = location.pathname;
  state.userId = user?.id;
  useEffect(() => {
    state.authenticated = !!user && !loading;
  }, [user, loading]);
  return visible ? createElement(Chat) : null;
}
state.bootstrap = () => {
  state.authenticated = false;
  state.chatMounted = false;
  root = createRoot(document.getElementById("root")!);
  root.render(
    createElement(
      QueryClientProvider,
      { client: queries },
      createElement(
        MemoryRouter,
        { initialEntries: [`/personal/${scope}`] },
        createElement(AuthProvider, null, createElement(Harness)),
      ),
    ),
  );
};
state.toggleChat = (value: boolean) => flushSync(() => toggle(value));
state.queryMetrics = () => ({
  cachedQueries: queries.getQueryCache().getAll().length,
  queryObservers: queries
    .getQueryCache()
    .getAll()
    .reduce((sum, item) => sum + item.getObserversCount(), 0),
  activeQueryFetches: queries.isFetching(),
});
state.startMedia = async () => {
  media = new ConferenceMediaClient(
    (action, data) => {
      const id = crypto.randomUUID();
      state.outgoing.push({ id, clientId: "a", action, data });
      return id;
    },
    (view) => {
      state.media = {
        active: view.active,
        state: view.connectionState,
        error: view.error,
      };
    },
  );
  state.clients.push(new WeakRef(media));
  await media.start(true);
};
state.handleMedia = (event) => media?.handle(event);
// Read-only test observation of the existing acknowledgement queue: do not leave
// during initial SDP/ready delivery merely because ICE connected first.
state.mediaSettled = () =>
  !!media &&
  !(media as any).negotiation &&
  (media as any).readyRequests.size === 0 &&
  media.snapshot().connectionState === "connected";
state.stopMedia = () => {
  media?.stop();
  media = null;
};
state.teardown = () => {
  state.stopMedia();
  root.unmount();
  queries.clear();
};
