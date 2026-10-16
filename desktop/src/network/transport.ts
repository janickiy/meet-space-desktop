import https from "node:https";
import type { EventEmitter } from "node:events";
import type { ClientRequest as NodeRequest, IncomingMessage } from "node:http";
import type { ClientRequest, Net, Session } from "electron";

export type ResponseHeaders = Record<string, string | string[]>;
export interface NativeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  signal: AbortSignal;
  maxResponseBytes: number;
  onHeaders?: (status: number, headers: ResponseHeaders) => void;
  onChunk?: (bytes: Uint8Array) => void | Promise<void>;
  onUploadProgress?: (loaded: number, total: number) => void;
}
export interface NativeResponse {
  status: number;
  headers: ResponseHeaders;
  body: Uint8Array;
}
export interface NativeTransport {
  request(input: NativeRequest): Promise<NativeResponse>;
}
export type TransportRequest = NativeRequest;
export type TransportResponse = NativeResponse;

/** Error details can contain credential-bearing URLs. Expose only these static codes. */
export function networkErrorCode(error: unknown): string {
  const item = error as { code?: unknown; message?: unknown } | null;
  const code = typeof item?.code === "string" ? item.code : "";
  const message = typeof item?.message === "string" ? item.message : "";
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|ISSUER/.test(code) || /net::ERR_(CERT_|SSL_)/.test(message)) return "tls_error";
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code) || /net::ERR_NAME_NOT_RESOLVED/.test(message)) return "dns_error";
  if (/^(ETIMEDOUT|ESOCKETTIMEDOUT)$/.test(code) || /net::ERR_(TIMED_OUT|CONNECTION_TIMED_OUT)/.test(message)) return "network_timeout";
  if (/redirect/i.test(message)) return "redirect_not_allowed";
  return "network_unavailable";
}

function normalizedHeaders(headers: Record<string, string | string[] | number | undefined>): ResponseHeaders {
  const output: ResponseHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) output[name.toLowerCase()] = Array.isArray(value) ? value : String(value);
  }
  return output;
}

/** The native request has no browser Origin/Fetch Metadata and never follows redirects. */
function execute(
  input: NativeRequest,
  make: () => NodeRequest | ClientRequest,
  timeoutMs: number,
): Promise<NativeResponse> {
  return new Promise((resolve, reject) => {
    if (input.signal.aborted) { reject(new Error("request_cancelled")); return; }
    let request: NodeRequest | ClientRequest;
    let finished = false;
    let timer: NodeJS.Timeout;
    const abort = () => fail("request_cancelled");
    const cleanup = () => { clearTimeout(timer); input.signal.removeEventListener("abort", abort); };
    const fail = (code: string) => {
      if (finished) return;
      finished = true; cleanup();
      if (request) {
        if ("destroy" in request) request.destroy(); else request.abort();
      }
      reject(new Error(code));
    };
    const deadline = () => { clearTimeout(timer); timer = setTimeout(() => fail("network_timeout"), timeoutMs); };
    try {
      if (new URL(input.url).protocol !== "https:") throw new Error("https_required");
      request = make();
      input.signal.addEventListener("abort", abort, { once: true });
      deadline();
      const events: EventEmitter = request;
      events.on("error", (error: unknown) => fail(networkErrorCode(error)));
      events.on("redirect", () => fail("redirect_not_allowed"));
      events.on("response", (response: IncomingMessage) => {
        // Attach before any onHeaders rejection can abort/destroy this response.
        response.on("error", () => fail("network_unavailable"));
        response.on("aborted", () => fail("network_unavailable"));
        const status = response.statusCode || 502;
        const headers = normalizedHeaders(response.headers);
        if (status >= 300 && status < 400) { fail("redirect_not_allowed"); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        let sink = Promise.resolve();
        try { input.onHeaders?.(status, headers); }
        catch { fail("invalid_response"); return; }
        response.on("data", (chunk: Uint8Array) => {
          if (finished) return;
          size += chunk.byteLength;
          if ((!input.onChunk && size > input.maxResponseBytes) || chunk.byteLength > 2 * 1024 * 1024) {
            fail("response_too_large"); return;
          }
          deadline();
          try {
            if (input.onChunk) {
              // File sinks can await disk writes; pause the native stream instead of
              // accumulating the complete recording in main-process memory.
              response.pause();
              // A paused player or disk sink is not a stalled network. Abort
              // signals remain active while the consumer deliberately waits.
              clearTimeout(timer);
              sink = sink.then(async () => {
                for (let offset = 0; offset < chunk.byteLength && !finished; offset += 32768)
                  await input.onChunk!(new Uint8Array(chunk.subarray(offset, offset + 32768)));
              });
              void sink.then(() => { if (!finished) { deadline(); response.resume(); } }, () => fail("invalid_response"));
            } else chunks.push(Buffer.from(chunk));
          } catch { fail("invalid_response"); }
        });
        response.on("end", () => {
          void sink.then(() => {
            if (finished) return;
            finished = true; cleanup();
            resolve({ status, headers, body: new Uint8Array(Buffer.concat(chunks)) });
          }, () => fail("invalid_response"));
        });
      });
      if (input.body) {
        request.write(Buffer.from(input.body));
        // This reports bytes handed to the transport, not server acceptance.
        input.onUploadProgress?.(input.body.byteLength, input.body.byteLength);
      }
      request.end();
    } catch (error) { fail(networkErrorCode(error)); }
  });
}

/** Node implementation supports isolated test CAs without a TLS bypass. */
export function createNodeHttpsTransport(options: { ca?: string | Buffer; timeoutMs?: number } = {}): NativeTransport {
  return {
    request: (input) => execute(input, () => https.request(input.url, {
      method: input.method, headers: input.headers, ca: options.ca, rejectUnauthorized: true,
    }), options.timeoutMs ?? 30000),
  };
}

/** Chromium networking uses the system proxy and trust store, isolated from renderer cookies. */
export function createElectronTransport(net: Net, browserSession: Session): NativeTransport {
  // Chromium adds Sec-Fetch-Site:none even to main-process requests. The server
  // intentionally treats a no-Origin request as native only when Fetch Metadata
  // is absent. This private session never belongs to a renderer. Do not apply
  // this filter to the renderer session or fabricate an Origin header.
  const active = new Map<string, number>();
  const requestKey = (method: string, url: string) => `${method} ${new URL(url).href}`;
  browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    const fromRenderer = (details.webContentsId ?? 0) > 0 || !!details.webContents || !!details.frame;
    const hasOrigin = Object.keys(headers).some((name) => name.toLowerCase() === "origin");
    if (fromRenderer || hasOrigin || !active.has(requestKey(details.method, details.url))) {
      callback({ cancel: true }); return;
    }
    for (const name of Object.keys(headers)) if (name.toLowerCase().startsWith("sec-fetch-")) delete headers[name];
    callback({ requestHeaders: headers });
  });
  return {
    request: (input) => {
      const key = requestKey(input.method, input.url);
      active.set(key, (active.get(key) ?? 0) + 1);
      return execute(input, () => {
        const request = net.request({ url: input.url, method: input.method, session: browserSession,
          redirect: "error", useSessionCookies: false, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
        for (const [name, value] of Object.entries(input.headers)) request.setHeader(name, value);
        return request;
      }, 35000).finally(() => {
        const remaining = (active.get(key) ?? 1) - 1;
        if (remaining) active.set(key, remaining); else active.delete(key);
      });
    },
  };
}
