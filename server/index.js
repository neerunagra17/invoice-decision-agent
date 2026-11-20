import http from 'http';
import { pathToFileURL } from 'url';
import { Server } from 'socket.io';
import { config } from './config.js';
import { loadReference } from './data/reference.js';
import { createStore } from './store/index.js';
import { createOrchestrator } from './pipeline/orchestrator.js';
import { createApp } from './app.js';
import { extractorLabel } from './llm/index.js';

export async function start({ port = config.port } = {}) {
  const ref = loadReference();
  const store = createStore();
  await store.init(ref.seedHistory);

  let io; // created below; emit only runs after the server is up
  const emit = run => {
    io.to(`run:${run.id}`).emit('run:update', run);
    io.emit('runs:changed', { id: run.id, status: run.status, decision: run.decision });
  };
  const orchestrator = createOrchestrator({ store, ref, emit });
  const app = createApp({ store, ref, orchestrator, onReset: () => io.emit('runs:changed', { reset: true }) });

  // Socket.io must wrap a server that already has the Express handler, so it can claim /socket.io requests first.
  const server = http.createServer(app);
  io = new Server(server, { cors: { origin: '*' } });
  // Clients join a room per run to receive its live updates; everyone gets a light "runs changed" ping for the dashboard.
  io.on('connection', socket => {
    socket.on('run:watch', async id => {
      if (typeof id !== 'string') return;
      socket.join(`run:${id}`);
      // Send the current state straight away, so a client that joins mid-run (or after it ended) is never stale.
      const run = await store.getRun(id).catch(() => null);
      if (run) socket.emit('run:update', run);
    });
    socket.on('run:unwatch', id => socket.leave(`run:${id}`));
  });

  await new Promise(r => server.listen(port, r));
  const actualPort = server.address().port;
  console.log(`Invoice agent on http://localhost:${actualPort} · extractor: ${extractorLabel()} · storage: ${store.mode}`);
  if (config.extractor === 'mock') console.warn('!! EXTRACTOR=mock: using test fixtures, not reading PDFs. Do not use for the demo.');
  if (config.extractor !== 'mock' && !config.gemini.apiKey) console.warn('!! GEMINI_API_KEY is not set: extraction will fail.');
  if (store.mode === 'memory') console.warn('!! No MONGODB_URI: runs are kept in memory and lost on restart.');
  return { server, io, port: actualPort, store, close: () => new Promise(r => { io.close(); server.close(() => r()); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
