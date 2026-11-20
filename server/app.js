// HTTP API. Processing happens in the orchestrator; these routes only start runs and read results.
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { poUsage } from './data/reference.js';
import { extractorLabel } from './llm/index.js';
import { pingGemini } from './llm/gemini.js';
import { looksLikePdf } from './lib/pdftext.js';

const summarise = r => ({
  id: r.id, createdAt: r.createdAt, fileName: r.fileName, source: r.source, status: r.status,
  decision: r.decision, headline: r.headline, reasonCount: r.reasons?.length || 0,
  vendor: r.vendor?.legalName ?? r.extracted?.fields?.vendor_name?.value ?? null,
  invoiceNumber: r.invoiceNumber, totalPaise: r.amounts?.totalPaise ?? null,
  poNumber: r.po?.poNumber ?? null, poInferred: r.po?.inferred ?? false,
  scanned: r.scanned, durationMs: r.durationMs,
  currentStage: r.stages?.find(s => s.status === 'running')?.label ?? null,
});

export function createApp({ store, ref, orchestrator, onReset = () => {} }) {
  const app = express();
  app.use(express.json());
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });
  const samples = JSON.parse(fs.readFileSync(path.join(config.samplesDir, 'manifest.json'), 'utf8'));
  const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

  app.get('/api/health', (req, res) => res.json({
    ok: true, extractor: extractorLabel(), mock: config.extractor === 'mock', storage: store.mode,
    inferredPoPolicy: config.rules.inferredPoPolicy, queue: orchestrator.queueLength(),
  }));
  app.get('/api/health/llm', wrap(async (req, res) => {
    if (config.extractor === 'mock') return res.json({ ok: true, detail: 'mock extractor (no LLM call)' });
    if (!config.gemini.apiKey) return res.status(500).json({ ok: false, detail: 'GEMINI_API_KEY is not set' });
    const r = await pingGemini();
    res.status(r.ok ? 200 : 502).json({ ...r, configured: config.gemini.model });
  }));

  // Start a run from an uploaded PDF. Returns immediately; progress arrives over Socket.io.
  app.post('/api/runs', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Attach a PDF in the "file" field.' });
    if (!looksLikePdf(req.file.buffer)) return res.status(415).json({ error: 'Only PDF invoices are accepted.' });
    const { run } = await orchestrator.submit({ buffer: req.file.buffer, name: req.file.originalname, mime: req.file.mimetype, source: 'upload' });
    res.status(202).json({ id: run.id });
  }));

  app.get('/api/samples', (req, res) => res.json(samples));
  app.post('/api/runs/sample/:file', wrap(async (req, res) => {
    const s = samples.find(x => x.file === req.params.file);
    if (!s) return res.status(404).json({ error: 'Unknown sample' });
    const buffer = fs.readFileSync(path.join(config.samplesDir, s.file));
    const { run } = await orchestrator.submit({ buffer, name: s.file, source: 'sample' });
    res.status(202).json({ id: run.id });
  }));
  app.get('/api/samples/:file', (req, res) => {
    const s = samples.find(x => x.file === req.params.file);
    if (!s) return res.status(404).end();
    res.type('application/pdf').sendFile(path.join(config.samplesDir, s.file));
  });

  app.get('/api/runs', wrap(async (req, res) => res.json((await store.listRuns()).map(summarise))));
  app.get('/api/runs/:id', wrap(async (req, res) => {
    const run = await store.getRun(req.params.id);
    run ? res.json(run) : res.status(404).json({ error: 'Run not found' });
  }));
  app.get('/api/runs/:id/file', wrap(async (req, res) => {
    const f = await store.getFile(req.params.id);
    if (!f) return res.status(404).end();
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', `inline; filename="${encodeURIComponent(f.name)}"`).send(f.buffer);
  }));

  // The simulated procurement system: vendors, POs (with live billed/remaining), and invoice history.
  app.get('/api/reference', wrap(async (req, res) => {
    const history = await store.getHistory();
    res.json({
      buyer: ref.buyer, vendors: ref.vendors,
      pos: ref.pos.map(p => ({ ...p, usage: poUsage(p, history) })),
      history: history.slice().reverse(),
      rules: config.rules,
    });
  }));
  app.post('/api/reference/reset', wrap(async (req, res) => {
    if (orchestrator.queueLength() > 0) return res.status(409).json({ error: 'Wait for queued runs to finish.' });
    await store.reset(ref.seedHistory);
    onReset();
    res.json({ ok: true });
  }));

  // Built React client (production). In development Vite serves it and proxies /api.
  const dist = path.join(config.root, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api|\/socket\.io).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 10 MB.' : err.message });
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  });
  return app;
}
