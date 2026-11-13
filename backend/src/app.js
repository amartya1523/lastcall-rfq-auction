import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');

export function createApp({ service, bus, clock = () => Date.now() }) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true, serverTime: clock() }));
  api.get('/events', bus.handler);
  api.get('/rfqs', (_req, res) => res.json({ serverTime: clock(), items: service.listRfqs() }));
  api.post('/rfqs', (req, res) => res.status(201).json(service.createRfq(req.body ?? {})));
  api.get('/rfqs/:id', (req, res) => res.json(service.getRfq(req.params.id)));
  api.post('/rfqs/:id/bids', (req, res) => res.status(201).json(service.submitBid(req.params.id, req.body ?? {})));
  app.use('/api', api);

  // In production the API also serves the built React app.
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message, fields: err.errors });
  });
  return app;
}
