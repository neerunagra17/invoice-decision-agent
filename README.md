# Invoice Decision Agent (Zamp PS-1)

Upload a vendor invoice PDF, digital or scanned, and the agent returns **APPROVE / HOLD / REJECT**. Each decision lists every check that ran and the reason it gives. For HOLD and REJECT it also drafts a message to the vendor. You can watch each run live, stage by stage. Every run is saved to a dashboard.

The buyer, vendors, purchase orders and invoice history are fictional. They stand in for a procurement system (see `PROCESS.md`, assumptions A1–A7).

```
PDF ─► 1 Receive ─► 2 Read ─► 3 Extract (LLM) ─► 4 Validate ─► 5 Vendor ─► 6 PO ─► 7 Lines & balance ─► 8 GST ─► 9 Duplicates ─► 10 Decide
                                 │                                                                                                │
                      the only LLM step                        all fixed rules in code                     REJECT > HOLD > APPROVE
```

## Run it locally

You need **Node.js 20 or newer** (22 LTS recommended) and a free **Gemini API key** from https://aistudio.google.com/apikey.

```bash
npm install
npm run build                 # builds the React UI into client/dist
cp .env.example .env          # Windows: copy .env.example .env
# open .env and paste your key: GEMINI_API_KEY=...
npm start
```

Open http://localhost:4000. Then:

1. Check the header: it should show `gemini · …` and `in-memory`.
2. To confirm the key works, open http://localhost:4000/api/health/llm. It should say `"ok": true` and name the model that answered.
3. Run the six sample invoices **in order** (01 → 06).

**Developing the UI?** Run `npm run dev` (API with auto-restart, port 4000) and `npm run dev:client` (Vite, port 5173, with hot reload) in two terminals, then open http://localhost:5173.

**Tests:** run `npm test`. These are 22 tests: helpers, the full pipeline on all six samples, regression tests for each rule that must never approve wrongly (`reg_*` fixtures), and the HTTP + Socket.io flow. The tests swap the LLM step for fixed fixtures (`EXTRACTOR=mock`). Everything after extraction is the real code. Never demo in mock mode: the UI shows a red banner when it is on.

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | – | Required for real runs |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Model that reads the invoice (pinned, verified on sample 01) |
| `GEMINI_FALLBACK_MODELS` | `gemini-flash-lite-latest,gemini-3.8-flash,gemini-3.5-flash` | Tried in order if the main model is busy (503/429), unavailable (404) or times out |
| `GEMINI_TIMEOUT_MS` / `GEMINI_TOTAL_BUDGET_MS` | `60000` / `150000` | Limit per call / for all attempts together; when used up, the run is held |
| `MONGODB_URI` | empty | Empty means runs are kept in memory and lost on restart |
| `INFERRED_PO_POLICY` | `hold` | No PO quoted and exactly one open PO fits: `hold` (suggest it; a person confirms) or `approve` (with a note) |
| `AUTO_APPROVE_LIMIT` | `1000000` | Rupees, incl. GST. Invoices above it always need a person. `0` = no limit |
| `EXTRACTOR` | `gemini` | `mock` is for automated tests only |
| `PORT` | `4000` | |

## Deploy (Render + MongoDB Atlas, both free)

1. **MongoDB Atlas.** Create a free M0 cluster. Under *Database Access*, add a user. Under *Network Access*, allow `0.0.0.0/0`, because Render's IP addresses change. Then go to *Connect → Drivers* and copy the connection string. Put a database name before the `?`, for example `.../invoice_agent?retryWrites=true&w=majority`.
2. **GitHub.** Push this folder to a new repo. `.env` is git-ignored; keep it that way.
3. **Render.** Choose *New → Web Service* and pick the repo.
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Instance type: Free
   - Environment: `GEMINI_API_KEY`, `MONGODB_URI`, `NODE_VERSION=22`
   - Alternatively, choose *New → Blueprint* and Render reads `render.yaml`.
4. Open the URL. The header should show `MongoDB`. Then check `/api/health/llm`.
5. **Before every demo:** the free instance sleeps after about 15 minutes idle, and the first request takes 30–60 s. Open the URL a minute early. Click **Reset demo data** on the *Reference data* page, then run the samples in order.

## What is where

```
server/
  index.js              HTTP server + Socket.io (one room per run → live updates)
  app.js                REST API: start runs, list/read runs, PDF file, reference data, reset, health
  config.js             env + business rules (tolerances, thresholds, policy)
  data/reference.js     loads data/*.csv: vendors, POs, seed history; poUsage() = billed/remaining per PO
  llm/                  gemini.js (REST call, retries, model fallback), prompt.js, schema.js (zod), mock.js (tests)
  lib/                  money (paise, ₹ formatting), normalise (GSTIN, PO ref, invoice no., dates), text (Dice), pdftext (pdf.js)
  pipeline/
    orchestrator.js     runs the 10 stages one invoice at a time; records status/timing/checks; emits updates
    stages/*.js         one file per stage; each returns { status, summary, checks[] }
  store/                memory.js (local/tests) and mongo.js (deployed): same interface
client/src/             React: Process (upload/samples), Runs (dashboard), Run (live view + detail), Reference data
data/                   the simulated procurement system (CSV/JSON)
samples/                six test invoices + manifest.json
tests/                  node:test suites + extraction fixtures
tools/                  make_invoices.py: regenerates the sample PDFs
```

## API

| Method | Path | |
|---|---|---|
| POST | `/api/runs` | multipart `file` (PDF) → `202 {id}`; processing continues in the background |
| POST | `/api/runs/sample/:file` | run a bundled sample |
| GET | `/api/runs` · `/api/runs/:id` · `/api/runs/:id/file` | dashboard list · full run record · original PDF |
| GET | `/api/reference` | vendors, POs with billed/remaining, invoice history, rules |
| POST | `/api/reference/reset` | delete runs and restore the starting history |
| GET | `/api/health` · `/api/health/llm` | status · test call to Gemini |
| Socket.io | emit `run:watch` id → receive `run:update` (full run) | the client also receives `runs:changed` for the dashboard |

## Known limitations (say these before you're asked)

- **Single-instance processing queue.** Runs are processed one at a time, in memory, so the duplicate check and PO balance always see the previous decision. Running several server instances would need a database-level lock or a job queue.
- **One PO per invoice.** An invoice that bills against two POs is held (its lines won't all match).
- **Scanned PDFs cannot be grounded.** There is no text layer to cross-check the model's reading against, so every scan is held for a person to confirm. Next step: read the scan twice and compare.
- **Two-way match only.** Invoices are checked against the PO, not against goods received (no GRN data).
- **No reviewer action yet.** A person's decision on a HOLD is not written back to the history.
- **The vendor message is a draft.** Nothing is sent, and nothing is paid. A person acts on HOLD and REJECT.
- **No login.** This is a demo. Anyone with the URL can upload invoices and reset the data.

## Design note

The interface uses a palette sampled from screenshots of zamp.ai (November 2026): page `#FCFCFC`, soft surface `#F4F4F4`, text `#181818`/`#4D4D4D`, black primary buttons, highlight blue `#4B8DBD` (darkened to `#2B6A99` for link text, 5.7:1 contrast) and pale blue `#EEF2FE`. Approve, Hold and Reject keep their own green, amber and red, each at least 4.5:1 on its tint. This is an independent project, not a Zamp product, and it does not use Zamp's logo. All colours are CSS variables at the top of `client/src/styles.css`.
