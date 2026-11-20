// MongoDB store (used when MONGODB_URI is set, e.g. on the deployed app).
import mongoose from 'mongoose';

const RunSchema = new mongoose.Schema({ _id: String, createdAt: String, data: mongoose.Schema.Types.Mixed }, { versionKey: false });
const FileSchema = new mongoose.Schema({ _id: String, name: String, mime: String, buffer: Buffer }, { versionKey: false });
const HistorySchema = new mongoose.Schema({ data: mongoose.Schema.Types.Mixed, createdAt: { type: Date, default: Date.now } }, { versionKey: false });

export function createMongoStore(uri) {
  const Run = mongoose.model('Run', RunSchema);
  const File = mongoose.model('File', FileSchema);
  const History = mongoose.model('History', HistorySchema);

  return {
    mode: 'mongo',
    async init(seedHistory) {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
      if ((await History.estimatedDocumentCount()) === 0) await History.insertMany(seedHistory.map(d => ({ data: d })));
    },
    async createRun(run) { await Run.create({ _id: run.id, createdAt: run.createdAt, data: run }); return run; },
    async updateRun(id, run) { await Run.updateOne({ _id: id }, { $set: { data: run } }); return run; },
    async getRun(id) { const d = await Run.findById(id).lean(); return d ? d.data : null; },
    async listRuns() { return (await Run.find().sort({ createdAt: -1 }).limit(500).lean()).map(d => d.data); },
    async saveFile(runId, f) { await File.create({ _id: runId, name: f.name, mime: f.mime, buffer: f.buffer }); },
    async getFile(runId) { const d = await File.findById(runId); return d ? { name: d.name, mime: d.mime, buffer: Buffer.from(d.buffer) } : null; },
    async getHistory() { return (await History.find().sort({ createdAt: 1 }).lean()).map(d => d.data); },
    async addHistory(entry) { await History.create({ data: entry }); },
    async reset(seedHistory) {
      await Promise.all([Run.deleteMany({}), File.deleteMany({}), History.deleteMany({})]);
      await History.insertMany(seedHistory.map(d => ({ data: d })));
    },
  };
}
