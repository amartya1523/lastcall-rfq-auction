import { useEffect, useRef, useState } from 'react';

// Browser clocks drift; every API response carries serverTime so countdowns
// are computed against the server, which is the clock bids are judged by.
let offset = 0;
export const syncServerTime = (serverTime) => {
  if (serverTime) offset = serverTime - Date.now();
};
export const serverNow = () => Date.now() + offset;

/** Re-renders every `ms` and returns the current server time. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * Subscribes to the server's SSE stream. `onEvent` gets every auction event;
 * the latest callback is always used without reconnecting.
 */
export function useLiveEvents(onEvent) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/events');
    const handle = (e) => {
      try {
        cb.current(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    es.addEventListener('hello', (e) => {
      setConnected(true);
      syncServerTime(JSON.parse(e.data).serverTime);
    });
    for (const type of ['rfq.created', 'bid.submitted', 'auction.closed']) es.addEventListener(type, handle);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return connected;
}
