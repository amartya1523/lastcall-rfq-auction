// Tiny in-process pub/sub used to push auction changes to browsers over SSE.
// For multiple API instances this would be swapped for Redis pub/sub.
export function createEventBus() {
  const clients = new Set();

  function publish(event) {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(payload);
  }

  function handler(req, res) {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`event: hello\ndata: ${JSON.stringify({ serverTime: Date.now() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  }

  return { publish, handler, size: () => clients.size };
}
