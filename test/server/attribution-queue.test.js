import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttributionQueue } from '../../src/server/attribution-queue.js';

test('queue bounds outstanding work, releases settled work, flushes and recovers after failure', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const states = [], persisted = [], ran = [];
  const queue = createAttributionQueue({ limit: 2, onState: state => states.push(state), persist: async state => persisted.push(state) });
  assert.equal(queue.enqueue(async () => { await gate; throw new Error('secret payload'); }), true);
  assert.equal(queue.enqueue(async () => { ran.push(2); }), true);
  assert.equal(queue.enqueue(async () => ran.push(3)), false);
  assert.equal((await queue.flush({ timeoutMs: 5 })).complete, false);
  release();
  assert.equal((await queue.flush()).complete, true);
  assert.deepEqual(ran, [2]);
  assert.equal(queue.stats().pendingCount, 0);
  assert.equal(queue.stats().failedWriteCount, 1);
  assert.equal(queue.stats().droppedCount, 1);
  assert.doesNotMatch(JSON.stringify(states), /secret/);
  queue.enqueue(async () => ran.push(4));
  await queue.flush({ close: true });
  assert.deepEqual(ran, [2, 4]);
  assert.equal(queue.enqueue(async () => {}), false);
  assert.equal(persisted.at(-1).pendingCount, 0);
});
