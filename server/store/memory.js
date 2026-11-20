// In-memory store: used for local development and automated tests. Data is lost on restart.
export function createMemoryStore() {
  let runs = new Map(), files = new Map(), history = [];
  const clone = x => structuredClone(x);
  return {
    mode: 'memory',
    async init(seedHistory) { history = clone(seedHistory); },
    async createRun(run) { runs.set(run.id, clone(run)); return clone(run); },
    async updateRun(id, run) { runs.set(id, clone(run)); return clone(run); },
    async getRun(id) { return runs.has(id) ? clone(runs.get(id)) : null; },
    async listRuns() { return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone); },
    async saveFile(runId, file) { files.set(runId, file); },
    async getFile(runId) { return files.get(runId) || null; },
    async getHistory() { return clone(history); },
    async addHistory(entry) { history.push(clone(entry)); },
    async reset(seedHistory) { runs = new Map(); files = new Map(); history = clone(seedHistory); },
  };
}
