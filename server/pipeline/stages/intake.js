import crypto from 'crypto';

// Stage 1 · Intake: fingerprint the file. (The run record itself is created by the orchestrator.)
export async function intake(ctx) {
  ctx.fileHash = crypto.createHash('sha256').update(ctx.file.buffer).digest('hex');
  ctx.run.fileHash = ctx.fileHash;
  return { summary: `Received ${ctx.file.name} (${(ctx.file.buffer.length / 1024).toFixed(1)} KB)`, checks: [] };
}
