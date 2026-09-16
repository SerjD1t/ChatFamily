import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initJoinFamily } from './join-family.js';
const require=createRequire(import.meta.url);
let JSDOM; try { ({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom')); } catch {}
test('joining without logout preserves drafts, prevents duplicate requests and supports retry', {skip:!JSDOM}, async()=>{
 const dom=new JSDOM(readFileSync(new URL('./index.html',import.meta.url),'utf8'));
 globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const $=s=>document.querySelector(s);
 const draft=document.createElement('textarea'); draft.value='Keep draft';document.body.append(draft);
 let requests=0, refresh=0, finish, fail=true, feedback='';
 initJoinFamily({locale:()=> 'ru',announce:message=>feedback=message,onJoined:async()=>{refresh++;},request:async(path,options)=>{
  requests++; assert.equal(path,'/invitations/join-by-code'); assert.deepEqual(JSON.parse(options.body),{token:'test-code'});
  await new Promise(resolve=>finish=resolve); if(fail)throw Error('denied');
 }});
 try {
  $('#openJoinFamily').click(); assert.equal($('#joinFamilyDialog').open,true);
  $('#joinFamilyCode').value='  test-code  ';
  const event={preventDefault(){}};
  const first=$('#joinFamilyForm').onsubmit(event); await $('#joinFamilyForm').onsubmit(event);
  assert.equal(requests,1);assert.equal($('#joinFamilyCode').disabled,true);
  finish();await first;
  assert.equal($('#joinFamilyDialog').open,true);assert.equal($('#joinFamilyCode').value,'  test-code  ');assert.ok($('#joinFamilyError').textContent);
  fail=false;const second=$('#joinFamilyForm').onsubmit(event);finish();await second;
  assert.equal(refresh,1);assert.equal($('#joinFamilyDialog').open,false);assert.equal($('#joinFamilyCode').value,'');assert.ok(feedback.includes('принято'));
  assert.equal(draft.value,'Keep draft');assert.ok(draft.isConnected);
 } finally {dom.window.close();delete globalThis.document;}
});
