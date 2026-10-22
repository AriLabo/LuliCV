/** A Bridge event as the editor sees it: a server-sent event by name, or `offline` when the stream drops. */
export type Deliver = (name: string, data?: string) => void;
export interface EventStream {
  reconnect(): void;
  close(): void;
}
const NAMES = ['connected', 'commit', 'themes', 'privacy', 'export-request'];
const SHARED = 'lulicv-events';
type Message = { name: string; data?: string; to?: string } | { hello: string };

/** One EventSource to `/api/events` owned by this tab. */
function ownEvents(deliver: Deliver): EventStream {
  let source: EventSource;
  const open = () => {
    source = new EventSource('/api/events');
    for (const name of NAMES)
      source.addEventListener(name, (event) => deliver(name, (event as MessageEvent<string>).data));
    source.onerror = () => deliver('offline');
  };
  open();
  return {
    reconnect: () => {
      source.close();
      open();
    },
    close: () => source.close(),
  };
}

/**
 * Bridge events for every editor tab of this origin over a single stream. Browsers allow about six open HTTP/1.1
 * connections per host and each EventSource keeps one, so with one stream per tab the seventh tab's requests would
 * wait forever. The tab holding the Web Lock opens the stream and relays it over a BroadcastChannel; when it closes,
 * the next tab waiting for the lock takes over, and its `connected` makes every tab fetch again what it may have missed.
 */
export function openEvents(deliver: Deliver): EventStream {
  if (typeof BroadcastChannel !== 'function' || !globalThis.navigator?.locks) return ownEvents(deliver);
  const id = Math.random().toString(36).slice(2);
  const channel = new BroadcastChannel(SHARED);
  const abort = new AbortController();
  let leader: EventStream | undefined;
  let live = false;
  let release: (() => void) | undefined;
  let closed = false;
  channel.onmessage = ({ data }: MessageEvent<Message>) => {
    // A tab that joins while the stream is up gets its own `connected`, so the others do not fetch again.
    if ('hello' in data) {
      if (live) channel.postMessage({ name: 'connected', to: data.hello });
      return;
    }
    if (!leader && (!data.to || data.to === id)) deliver(data.name, data.data);
  };
  void navigator.locks
    .request(
      SHARED,
      { signal: abort.signal },
      () =>
        new Promise<void>((resolve) => {
          if (closed) {
            resolve();
            return;
          }
          release = resolve;
          leader = ownEvents((name, data) => {
            live = name === 'connected' || (live && name !== 'offline');
            deliver(name, data);
            channel.postMessage({ name, data });
          });
        }),
    )
    .catch(() => {});
  channel.postMessage({ hello: id });
  return {
    reconnect: () => leader?.reconnect(),
    close: () => {
      closed = true;
      abort.abort();
      leader?.close();
      release?.();
      channel.close();
    },
  };
}
