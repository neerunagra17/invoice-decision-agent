// HTTP + Socket.io smoke test: start the real server, run a sample, and watch its live stage events.
process.env.EXTRACTOR = 'mock';
process.env.MONGODB_URI = '';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const { start } = await import('../server/index.js');

test('upload → live stage events → decision → dashboard → reset', async () => {
  const srv = await start({ port: 0 });
  const base = `http://localhost:${srv.port}`;
  const socket = io(base, { transports: ['websocket'] });
  try {
    assert.equal((await (await fetch(`${base}/api/health`)).json()).storage, 'memory');

    const bad = await fetch(`${base}/api/runs`, { method: 'POST', body: (() => { const f = new FormData(); f.append('file', new Blob(['not a pdf']), 'x.txt'); return f; })() });
    assert.equal(bad.status, 415);

    if (!socket.connected) await new Promise(r => socket.once('connect', r));
    const res = await fetch(`${base}/api/runs/sample/01_happy_nimbus_laptops.pdf`, { method: 'POST' });
    assert.equal(res.status, 202);
    const { id } = await res.json();

    const final = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out')), 10000);
      socket.on('run:update', run => {
        if (run.status === 'completed') { clearTimeout(t); resolve(run); }
      });
      socket.emit('run:watch', id);
    });
    // (The run may finish before we join the room; joining always sends the current state, so we still get the final run.)
    assert.equal(final.decision, 'APPROVE');

    const list = await (await fetch(`${base}/api/runs`)).json();
    assert.equal(list[0].id, id);
    assert.equal(list[0].decision, 'APPROVE');
    const pdf = await fetch(`${base}/api/runs/${id}/file`);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');

    const refData = await (await fetch(`${base}/api/reference`)).json();
    assert.equal(refData.pos.find(p => p.poNumber === 'PO-2026-0418').usage.remainingPaise, 0);
    assert.equal((await fetch(`${base}/api/reference/reset`, { method: 'POST' })).status, 200);
    assert.equal((await (await fetch(`${base}/api/runs`)).json()).length, 0);
  } finally {
    socket.close();
    await srv.close();
  }
});
