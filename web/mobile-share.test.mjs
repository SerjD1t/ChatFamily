import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
let JSDOM; try { ({ JSDOM }=require(process.env.TEST_JSDOM_PATH || 'jsdom')); } catch {}

test('Android shares require explicit confirmation and preserve the chat DOM', {skip:!JSDOM}, async()=>{
 const dom=new JSDOM('<aside><label class="sidebarSearch"></label></aside><dialog id="userMenuDialog"><button id="myProfile">Profile</button></dialog><article id="message">Existing message</article><textarea id="draft">Unsent draft</textarea>',{url:'https://chatfamily.site/',pretendToBeVisual:true});
 globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 globalThis.Option=dom.window.Option;
 let jobs=[{id:'12345678-1234-1234-1234-123456789abc',state:'draft',body:'Shared link',files:[{name:'<unsafe>.txt',bytes:12}]}];
 const submissions=[];
 const plugin={list:async()=>({jobs}),submit:async data=>{submissions.push(data);jobs=[{...jobs[0],...data,state:'queued'}];},discard:async()=>{jobs=[];}};
 globalThis.Capacitor={isNativePlatform:()=>true,registerPlugin:()=>plugin};
 const original=globalThis.setInterval; let tick; globalThis.setInterval=fn=>{tick=fn;return 1;};
 try {
  const {initIncomingShares}=await import('./mobile/incoming-share.js');
  const message=document.querySelector('#message'), draft=document.querySelector('#draft');
  const request=async path=>path==='/conversations'?[{id:'c1',title:'Family',kind:'family',familyId:'f1'}]:path==='/families'?[{id:'f1',title:'Family space'}]:[];
  initIncomingShares({user:{ID:'u1',Name:'Me'},locale:()=> 'en',request,onSent:()=>{}});
  await new Promise(r=>setTimeout(r,0));
  assert.equal(submissions.length,0,'Receiving files must not send');
  assert.ok(document.querySelector('dialog[open]'));
  assert.ok(document.querySelector('.shareQueue').textContent.includes('<unsafe>.txt'));
  assert.equal(document.querySelector('unsafe'),null);
  document.querySelector('[data-action="choose"]').click();
  await new Promise(r=>setTimeout(r,0));
  document.querySelector('[data-recipient="chat:c1"]').click();
  const caption=document.querySelector('.shareCaption'); caption.value='My caption'; caption.focus();
  await tick();
  assert.equal(document.querySelector('.shareCaption'),caption);
  assert.equal(caption.value,'My caption');
  assert.equal(document.activeElement,caption);
  document.querySelector('.shareForm').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  await new Promise(r=>setTimeout(r,0));
  assert.equal(submissions.length,1); assert.equal(submissions[0].conversationId,'c1'); assert.equal(submissions[0].userId,'u1');
  assert.equal(document.querySelector('#message'),message); assert.equal(document.querySelector('#draft'),draft); assert.equal(draft.value,'Unsent draft');
  jobs=[{id:'other',userId:'another',state:'failed',body:'Private',files:[]}]; await tick();
  assert.equal(document.querySelector('.shareQueue').textContent.includes('Private'),false);
 } finally { globalThis.setInterval=original; delete globalThis.Capacitor; dom.window.close(); }
});
