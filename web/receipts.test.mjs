import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleMessageIDs, createReceipts } from './receipts.js';

test('reading requires focus, visible viewport, and excludes own/deleted/offscreen messages', () => {
  let focused = true;
  const rect = { top: 0, bottom: 200, left: 0, right: 300, width: 300, height: 200 };
  const node = (id, author, top, deleted = false) => ({ dataset: { messageId: id, authorId: author, deleted: String(deleted) },
    getBoundingClientRect: () => ({ ...rect, top, bottom: top + 60, height: 60 }) });
  const root = { getBoundingClientRect: () => rect,
    querySelectorAll: () => [node('visible', 'other', 10), node('own', 'me', 10), node('below', 'other', 220), node('deleted', 'other', 10, true)] };
  const doc = { visibilityState: 'visible', hasFocus: () => focused, defaultView: { innerHeight: 500, innerWidth: 500 } };
  assert.deepEqual(visibleMessageIDs(root, 'me', doc), ['visible']);
  focused = false; assert.deepEqual(visibleMessageIDs(root, 'me', doc), []);
  focused = true; doc.visibilityState = 'hidden'; assert.deepEqual(visibleMessageIDs(root, 'me', doc), []);
});

test('read acknowledgement waits for a second visible scan and is idempotent', async () => {
  const rect = { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 };
  globalThis.document = { visibilityState: 'visible', hasFocus: () => true, defaultView: { innerHeight: 500, innerWidth: 500 }, addEventListener() {}, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
  const root = { getBoundingClientRect: () => rect, querySelectorAll: () => [{ dataset: { messageId: 'one', authorId: 'other' }, getBoundingClientRect: () => rect }] };
  const writes = [];
  const receipts = createReceipts({ root: () => root, userID: () => 'me', request: async (path, options) => { writes.push(JSON.parse(options.body)); } });
  await receipts.scan(); assert.equal(writes.length, 0);
  await receipts.scan(); assert.deepEqual(writes, [{ messageIds: ['one'], read: true }]);
  await receipts.scan(); assert.equal(writes.length, 1);
  receipts.destroy();
});
