import { desktopBridge } from "./desktop";
import type {
  DesktopHttpRequest,
  DesktopSocketRequest,
} from "./desktop-contracts";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_STREAM_QUEUE = 256 * 1024;
const abortError = () => new DOMException("Request aborted", "AbortError");

/** The browser sees response data and an opaque identity marker, never native credentials. */
export async function desktopRequest(
  request: Omit<DesktopHttpRequest, "id" | "bytes"> & { file?: Blob },
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<Response> {
  signal?.throwIfAborted();
  if (request.file && request.file.size > MAX_UPLOAD_BYTES)
    throw new Error("upload_too_large");
  const bytes = request.file
    ? new Uint8Array(await request.file.arrayBuffer())
    : undefined;
  signal?.throwIfAborted();
  const bridge = desktopBridge();
  const id = crypto.randomUUID();
  const { file: _file, ...input } = request;
  let aborted = false;
  let rejectAbort: (error: Error) => void = () => {};
  const abortedPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    aborted = true;
    void bridge.abortRequest(id).catch(() => {});
    rejectAbort(abortError());
  };
  const unsubscribe = onProgress
    ? bridge.onTransportEvent((event) => {
        if (
          event.kind === "progress" &&
          event.id === id &&
          !aborted &&
          Number.isFinite(event.percent)
        )
          onProgress(Math.min(100, Math.max(0, event.percent)));
      })
    : () => {};
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await Promise.race([
      bridge.http({ ...input, id, bytes }),
      abortedPromise,
    ]);
    signal?.throwIfAborted();
    if (
      !Number.isInteger(response.status) ||
      response.status < 200 ||
      response.status > 599
    )
      throw new Error("invalid_response");
    const body =
      response.body instanceof Uint8Array
        ? new Uint8Array(response.body)
        : JSON.stringify(response.body ?? null);
    if (
      (typeof body === "string"
        ? new TextEncoder().encode(body).length
        : body.byteLength) > MAX_RESPONSE_BYTES
    )
      throw new Error("response_too_large");
    return new Response(
      [204, 205, 304].includes(response.status) ? null : body,
      {
        status: response.status,
        headers: { ...response.headers },
      },
    );
  } finally {
    signal?.removeEventListener("abort", abort);
    unsubscribe();
  }
}

/** Adapt native, bounded SSE chunks to the shared parser's standard Response contract. */
export function desktopNotificationStream(
  token: string | null,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();
  const bridge = desktopBridge();
  const id = crypto.randomUUID();
  return new Promise<Response>((resolve, reject) => {
    let done = false;
    let headersReceived = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let unsubscribe = () => {};
    const timeout = window.setTimeout(
      () => fail(new Error("stream_timeout")),
      30_000,
    );
    const cleanup = () => {
      unsubscribe();
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      void bridge.closeStream(id).catch(() => {});
    };
    const fail = (error: Error) => {
      if (done) return;
      done = true;
      cleanup();
      controller.error(error);
      if (!headersReceived) reject(error);
    };
    const abort = () => fail(abortError());
    const stream = new ReadableStream<Uint8Array>(
      {
        start(value) {
          controller = value;
        },
        cancel() {
          if (!done) {
            done = true;
            cleanup();
          }
        },
      },
      { highWaterMark: MAX_STREAM_QUEUE, size: (chunk) => chunk.byteLength },
    );
    unsubscribe = bridge.onTransportEvent((event) => {
      if (done || event.kind !== "stream" || event.id !== id) return;
      if (event.type === "headers") {
        if (
          headersReceived ||
          !event.status ||
          event.status < 200 ||
          event.status > 599
        ) {
          fail(new Error("invalid_stream"));
          return;
        }
        headersReceived = true;
        clearTimeout(timeout);
        if ([204, 205, 304].includes(event.status)) {
          done = true;
          controller.close();
          cleanup();
          resolve(
            new Response(null, {
              status: event.status,
              headers: { ...event.headers },
            }),
          );
        } else
          resolve(
            new Response(stream, {
              status: event.status,
              headers: { ...event.headers },
            }),
          );
      } else if (event.type === "chunk") {
        if (
          !headersReceived ||
          !(event.data instanceof Uint8Array) ||
          event.data.byteLength > MAX_STREAM_QUEUE ||
          (controller.desiredSize ?? 0) < event.data.byteLength
        ) {
          fail(new Error("stream_overflow"));
          return;
        }
        controller.enqueue(new Uint8Array(event.data));
      } else if (event.type === "end") {
        if (!headersReceived) {
          fail(new Error("invalid_stream"));
          return;
        }
        done = true;
        controller.close();
        cleanup();
      } else if (event.type === "error") fail(new Error("stream_unavailable"));
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else
      void bridge
        .openStream({ id, token })
        .catch(() => fail(new Error("stream_unavailable")));
  });
}

export interface RealtimeSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** A small WebSocket-compatible transport; all URL/ticket/auth work stays in main. */
export class DesktopSocket extends EventTarget implements RealtimeSocket {
  readyState = 0;
  bufferedAmount = 0;
  onopen: RealtimeSocket["onopen"] = null;
  onmessage: RealtimeSocket["onmessage"] = null;
  onerror: RealtimeSocket["onerror"] = null;
  onclose: RealtimeSocket["onclose"] = null;
  private readonly bridge = desktopBridge();
  private readonly id = crypto.randomUUID();
  private unsubscribe = () => {};
  private removeAbort = () => {};

  constructor(input: Omit<DesktopSocketRequest, "id">, signal?: AbortSignal) {
    super();
    this.unsubscribe = this.bridge.onTransportEvent((event) => {
      if (
        event.kind !== "socket" ||
        event.id !== this.id ||
        this.readyState >= 2
      )
        return;
      if (event.type === "open") {
        this.readyState = 1;
        const opened = new Event("open");
        this.onopen?.(opened);
        this.dispatchEvent(opened);
      } else if (event.type === "message" && typeof event.data === "string") {
        if (new TextEncoder().encode(event.data).byteLength > 256 * 1024) {
          this.close();
          return;
        }
        const message = new MessageEvent("message", { data: event.data });
        this.onmessage?.(message);
        this.dispatchEvent(message);
      } else if (event.type === "close")
        this.finish(event.code ?? 1006, event.reason ?? "");
      else if (event.type === "error") this.fail();
    });
    const abort = () => this.close();
    signal?.addEventListener("abort", abort, { once: true });
    this.removeAbort = () => signal?.removeEventListener("abort", abort);
    queueMicrotask(() => {
      if (signal?.aborted || this.readyState !== 0) {
        this.close();
        return;
      }
      void this.bridge
        .openSocket({ ...input, id: this.id })
        .catch(() => this.fail());
    });
  }
  send(data: string): void {
    if (this.readyState !== 1)
      throw new DOMException("Socket is not open", "InvalidStateError");
    const size = new TextEncoder().encode(data).length;
    if (size > 65536 || this.bufferedAmount + size > 131072)
      throw new Error("socket_backpressure");
    this.bufferedAmount += size;
    void this.bridge
      .sendSocket(this.id, data)
      .catch(() => this.fail())
      .finally(() => {
        this.bufferedAmount -= size;
      });
  }
  close(): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    void this.bridge.closeSocket(this.id).catch(() => {});
    this.finish(1000, "");
  }
  private fail(): void {
    if (this.readyState >= 2) return;
    const error = new Event("error");
    this.onerror?.(error);
    this.dispatchEvent(error);
    void this.bridge.closeSocket(this.id).catch(() => {});
    this.finish(1006, "");
  }
  private finish(code: number, reason: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.unsubscribe();
    this.removeAbort();
    const closed = new CloseEvent("close", {
      code,
      reason,
      wasClean: code === 1000,
    });
    this.onclose?.(closed);
    this.dispatchEvent(closed);
  }
}
