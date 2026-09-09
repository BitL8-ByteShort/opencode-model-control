import { randomUUID } from "node:crypto";
// Accounting never runs on the provider critical path. Only queued functions,
// not already-started promises, enter this bounded serial worker.
export function createAttributionQueue({ limit = 1000, onState = () => {}, persist = async () => {} } = {}) {
  const tasks = [];
  let running = null, closed = false;
  const state = { queueId: randomUUID(), pendingCount: 0, failedWriteCount: 0, droppedCount: 0, lastFailureCode: null };
  const publish = () => onState({ ...state });
  function start() {
    if (running) return;
    running = Promise.resolve().then(async () => {
      while (tasks.length) {
        const work = tasks.shift();
        try { await work(); }
        catch { state.failedWriteCount++; state.lastFailureCode = 'ATTRIBUTION_WRITE_FAILED'; }
        state.pendingCount--; publish();
      }
      try { await persist({ ...state }); }
      catch { state.failedWriteCount++; state.lastFailureCode = 'ATTRIBUTION_WRITE_FAILED'; publish(); }
    }).finally(() => { running = null; if (tasks.length) start(); });
  }
  return {
    enqueue(work) {
      if (closed || state.pendingCount >= limit) { state.droppedCount++; publish(); return false; }
      tasks.push(work); state.pendingCount++; publish(); start(); return true;
    },
    stats() { return { ...state }; },
    async flush({ timeoutMs = 2000, close = false } = {}) {
      if (close) closed = true;
      let timer;
      const drain = async () => { while (running) await running; };
      const complete = await Promise.race([drain().then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
      clearTimeout(timer);
      return { ...state, complete };
    },
  };
}
