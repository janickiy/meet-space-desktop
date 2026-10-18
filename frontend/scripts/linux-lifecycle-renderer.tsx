// Test-only extension of the established stage07 shared-module harness.
// No production frontend is copied; all application behavior comes from @app.
import {createElement, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router';
import {AuthProvider, useAuth} from '../src/auth';
import {MessageThread} from '../src/components/ChatPanel';
import {DesktopSessionGate} from '../src/components/desktop/DesktopSessionGate';
import {personalChatAPI} from '../src/api';
import {usePersonalRealtime} from '../src/personalRealtime';
import {ConferenceMediaClient} from '../src/media';

const state = (window as any).__lifecycleQA;
const scope = '55555555-5555-4555-8555-555555555555';
const queries = new WeakMap<object, number>();
let querySequence = 0;
let activeQuery: QueryClient | null = null;
let toggle: (enabled: boolean) => void;
let root: ReturnType<typeof createRoot> | null = null;
let media: ConferenceMediaClient | null = null;
state.queryRefs = [];
state.clientRefs = [];
state.authMounted = false;
state.chatMounted = false;
function Chat() {
  const {user} = useAuth();
  usePersonalRealtime(user?.id);
  useEffect(() => { state.chatMounted = true; return () => { state.chatMounted = false; }; }, []);
  return createElement(MessageThread, {scopeId: scope, transport: personalChatAPI, personal: true, readOnly: false});
}
function Harness() {
  const auth = useAuth();
  const [visible, setVisible] = useState(false);
  toggle = setVisible;
  state.login = auth.login;
  state.logout = auth.logout;
  state.userId = auth.user?.id ?? null;
  state.authenticated = !!auth.user && !auth.loading;
  state.authLoading = auth.loading;
  useEffect(() => { state.authMounted = true; return () => { state.authMounted = false; }; }, []);
  return visible && auth.user ? createElement(Chat) : null;
}
function Application({profileKey}: {profileKey: string}) {
  const [client] = useState(() => new QueryClient());
  state.profileKey = profileKey;
  activeQuery = client;
  useEffect(() => {
    const observe = ({query}: any) => {
      if (query && !queries.has(query)) {
        queries.set(query, ++querySequence);
        state.queryRefs.push(new WeakRef(query));
      }
    };
    for (const query of client.getQueryCache().getAll()) observe({query});
    const off = client.getQueryCache().subscribe(observe);
    return () => {
      off();
      void client.cancelQueries();
      client.clear();
      if (activeQuery === client) activeQuery = null;
    };
  }, [client]);
  return createElement(QueryClientProvider, {client}, createElement(AuthProvider, null, createElement(Harness)));
}
state.bootstrap = () => {
  if (root) throw Error('fixture already mounted');
  root = createRoot(document.getElementById('root')!);
  root.render(createElement(MemoryRouter, {initialEntries: [`/personal/${scope}`]},
    createElement(DesktopSessionGate, {children: (key: string) => createElement(Application, {key, profileKey: key})})));
};
state.toggleChat = (value: boolean) => flushSync(() => toggle(value));
state.queryMetrics = () => {
  const cache = activeQuery?.getQueryCache().getAll() ?? [];
  const current = new Set(cache);
  let retainedQueries = 0, detachedQueries = 0, detachedObservers = 0;
  for (const ref of state.queryRefs) {
    const query = ref.deref();
    if (!query) continue;
    retainedQueries++;
    if (!current.has(query)) { detachedQueries++; detachedObservers += query.getObserversCount(); }
  }
  return {cachedQueries: cache.length, queryObservers: cache.reduce((n, query) => n + query.getObserversCount(), 0),
    activeQueryFetches: activeQuery?.isFetching() ?? 0, retainedQueries, detachedQueries, detachedObservers};
};
state.startMedia = async () => {
  if (media) throw Error('old media still owned');
  media = new ConferenceMediaClient((action, data) => {
    const id = crypto.randomUUID(); state.outgoing.push({id, clientId:'a', action, data}); return id;
  }, view => { state.media = {active:view.active, connectionState:view.connectionState, error:view.error}; });
  state.clientRefs.push(new WeakRef(media));
  await media.start(true);
};
state.handleMedia = (event: any) => media?.handle(event);
state.mediaSettled = () => !!media && !(media as any).negotiation && (media as any).readyRequests.size === 0 && media.snapshot().connectionState === 'connected';
state.mediaMetrics = () => {
  const value = media?.snapshot();
  return {active:!!value?.active, microphoneEnabled:!!value?.microphoneEnabled, cameraEnabled:!!value?.cameraEnabled,
    screenSharing:!!value?.screenSharing, localTracks:value?.localStream?.getTracks().filter(track=>track.readyState==='live').length ?? 0,
    screenTracks:value?.localScreen?.getTracks().filter(track=>track.readyState==='live').length ?? 0,
    pendingCapture:(media as any)?.pendingCapture.size ?? 0, readyRequests:(media as any)?.readyRequests.size ?? 0};
};
state.replaceCamera = () => media?.changeSource('camera', true);
state.replaceMicrophone = () => media?.changeSource('microphone', true);
state.startScreen = () => media?.startScreen();
state.stopScreen = () => media?.stopScreen();
state.stopMedia = () => { media?.stop(); media = null; };
state.teardown = () => {
  state.stopMedia();
  root?.unmount(); root = null;
  state.login = null; state.logout = null; toggle = () => {};
};
