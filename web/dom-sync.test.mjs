import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { syncMarkup } from './dom-sync.js';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require(process.env.TEST_JSDOM_PATH || 'jsdom')); } catch {}

test('updates preserve message nodes, focus and drafts; identical events are no-ops', { skip: !JSDOM }, () => {
  const dom = new JSDOM('<main></main>');
  globalThis.document = dom.window.document;
  const root = document.querySelector('main');
  const html = '<article data-message-id="one"><p>Message</p><div class="reactions">👍 1</div></article><input id="draft">';
  syncMarkup(root, html);
  const article = root.firstChild, body = article.firstChild, draft = document.querySelector('#draft');
  draft.value = 'Unsaved'; draft.focus();
  syncMarkup(root, html.replace('👍 1', '👍 2'));
  assert.equal(root.firstChild, article);
  assert.equal(article.firstChild, body);
  assert.equal(document.activeElement, draft);
  assert.equal(draft.value, 'Unsaved');
  const observer = new dom.window.MutationObserver(() => {});
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  syncMarkup(root, html.replace('👍 1', '👍 2'));
  assert.equal(observer.takeRecords().length, 0);
  syncMarkup(root, '<article data-message-id="older"><p>Older</p></article>' + html.replace('👍 1', '👍 2'));
  assert.equal(root.querySelector('[data-message-id="one"]'), article);
  assert.equal(document.querySelector('#draft'), draft);
  observer.disconnect(); dom.window.close();
});

test('reaction and repeated WebSocket events preserve the chat and composer', { skip: !JSDOM }, async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  for (const name of ['window', 'document', 'Node', 'NodeFilter', 'Element', 'MutationObserver', 'localStorage', 'sessionStorage', 'location', 'history']) globalThis[name] = dom.window[name];
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.CSS = { escape: value => value };
  let socket;
  globalThis.WebSocket = class { constructor() { socket = this; } };
  const message = { id: 'm1', authorId: 'u1', authorName: 'User', body: 'Hello', createdAt: '2026-09-16T10:00:00Z', reactions: [] };
  let reads = 0, receiptStatus = 'sent';
  globalThis.fetch = async (url, options = {}) => {
    const path = url.replace('/api/v1', '');
    let data;
    if (path === '/auth/me') data = { ID: 'u1', Name: 'User', Permissions: {} };
    else if (path === '/families') data = [{ id: 'f1', title: 'Family', role: 'owner' }];
    else if (path === '/user/preferences') data = { locale: 'ru', colorScheme: 'light' };
    else if (path === '/password-policy') data = { minPasswordLength: 12 };
    else if (path === '/conversations') data = [{ id: 'c1', kind: 'family', familyId: 'f1', title: 'Family' }];
    else if (path.includes('/messages?')) { reads++; data = { messages: [message] }; }
    else if (path === '/message-statuses') data = { m1: receiptStatus };
    else if (path === '/messages/m1/reactions') {
      if (options.method === 'POST') { message.reactions = [{ emoji: '👍', count: 1, reacted: true }]; await socket.onmessage({ data: JSON.stringify({ type: 'reaction.updated', conversationId: 'c1', messageId: 'm1' }) }); }
      data = message.reactions;
    } else data = [];
    return { ok: true, status: 200, json: async () => structuredClone(data) };
  };
  await import('./app.js');
  await new Promise(resolve => setTimeout(resolve, 30));
  const article = document.querySelector('[data-message-id="m1"]');
  assert.ok(article);
  const composer = document.querySelector('#body'); composer.value = 'Draft'; composer.focus();
  const baseline = reads;
  article.querySelector('[data-add-reaction]').click();
  document.querySelector('#reactionPicker [data-emoji="👍"]').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(reads, baseline, 'reaction must not fetch message history');
  assert.equal(document.querySelector('[data-message-id="m1"]'), article);
  assert.match(article.querySelector('.reactions').textContent, /👍 1/);
  const event = { data: JSON.stringify({ type: 'message.updated', conversationId: 'c1', messageId: 'm1' }) };
  await socket.onmessage(event); await socket.onmessage(event);
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.equal(reads, baseline + 1, 'duplicate events should be batched');
  assert.equal(document.querySelector('[data-message-id="m1"]'), article);
  assert.equal(composer.value, 'Draft');
  assert.equal(document.activeElement, composer);
  receiptStatus = 'read';
  await socket.onmessage({ data: JSON.stringify({ type: 'message.status', conversationId: 'c1' }) });
  assert.equal(reads, baseline + 1, 'receipt event must not fetch history');
  assert.equal(document.querySelector('[data-message-id="m1"]'), article);
  assert.match(article.querySelector('[data-status-id="m1"]').innerHTML, /read/);
  assert.equal(composer.value, 'Draft');
  dom.window.close();
});
