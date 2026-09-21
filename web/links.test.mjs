import test from 'node:test';import assert from 'node:assert/strict';
import {messageLinks,linkMarkup} from './links.js';
test('message links are escaped, only HTTP(S), credentials excluded',()=>{
 const result=messageLinks('<img onerror=alert(1)> https://example.test/?a=1&b=2. javascript:alert(1) https://user:secret@example.test/');
 assert.equal(result.links.length,1);assert.equal(result.links[0],'https://example.test/?a=1&b=2');
 assert.match(result.html,/&lt;img/);assert.doesNotMatch(result.html,/<img/);assert.match(result.html,/rel="noopener noreferrer"/);assert.match(result.html,/a=1&amp;b=2/);
 assert.equal((result.html.match(/<a /g)||[]).length,1);
});
test('only one compact preview per message and no remote image',()=>{
 const result=linkMarkup('https://example.test/a https://other.test/b');assert.equal((result.preview.match(/data-link-preview/g)||[]).length,1);assert.doesNotMatch(result.preview,/<img/);
 assert.equal(linkMarkup('plain text').preview,'');assert.equal(messageLinks('a & b').html,'a &amp; b');
});
test('balanced parentheses inside URLs are not stripped',()=>{
 assert.equal(messageLinks('(https://example.test/wiki/Item_(test)).').links[0],'https://example.test/wiki/Item_(test)');
});
