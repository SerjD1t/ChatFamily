import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {initMessageActions,messageActionsMarkup} from './message-actions.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
test('forward picker confirms, keeps DOM, retries with same request and recipient',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<article class="bubble"></article><textarea>Draft</textarea>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const tick=()=>new Promise(r=>setTimeout(r,0));const calls=[];let fail=true,sent=0;
 const request=async(path,options)=>{if(path==='/conversations')return [{id:'destination',title:'Synthetic family',familyId:'f',kind:'family'}];if(path==='/families')return [{id:'f',title:'Space'}];if(path==='/contacts')return [{ID:'contact',Name:'Synthetic Contact'}];calls.push({path,...options});if(fail)throw Error('Network');return {conversationId:'destination'};};
 try{
  const article=document.querySelector('article');article.innerHTML=messageActionsMarkup({id:'source'},'en');initMessageActions({request,user:()=>({ID:'self',Name:'Self'}),locale:()=> 'en',onSent:()=>sent++});
  document.querySelector('[data-message-menu]').click();assert.equal(document.querySelector('[data-message-menu]').getAttribute('aria-expanded'),'true');document.querySelector('textarea').click();assert.equal(document.querySelector('.messageActionMenu'),null);
  document.querySelector('[data-message-menu]').click();document.querySelector('[data-forward]').click();await tick();
  assert.equal(calls.length,0);assert.ok(document.querySelector('[data-key="user:self"]'));assert.ok(document.querySelector('[data-key="user:contact"]'));
  document.querySelector('[data-key="chat:destination"]').click();assert.equal(calls.length,0);document.querySelector('[data-send]').click();await tick();
  assert.equal(calls.length,1);assert.ok(document.querySelector('dialog').open);assert.equal(document.querySelector('[data-key="user:self"]').disabled,true);
  fail=false;document.querySelector('[data-send]').click();await tick();assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.equal(JSON.parse(calls[0].body).conversationId,'destination');assert.equal(sent,1);assert.equal(document.querySelector('dialog'),null);
  assert.equal(document.querySelector('article'),article);assert.equal(document.querySelector('textarea').value,'Draft');
 }finally{dom.window.close();delete globalThis.document;}
});
