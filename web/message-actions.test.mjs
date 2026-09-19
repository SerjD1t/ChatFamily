import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {initMessageActions,messageActionsMarkup} from './message-actions.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}

for(const own of [true,false])test(`touch actions: hold, movement, attachment tap, ownership ${own}`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<article class="message" data-message-id="m" data-deleted="false"><div class="bubble"><p class="messageBody">Synthetic</p><a class="attachmentCard" href="#file">File</a></div></article><textarea>Draft</textarea>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 const article=document.querySelector('article'),body=document.querySelector('.messageBody');article.querySelector('.bubble').insertAdjacentHTML('beforeend',messageActionsMarkup({id:'m'}));
 let reactions=[];initMessageActions({request:async()=>[],user:()=>({ID:'self'}),getMessage:()=>({id:'m',body:'Synthetic',authorId:own?'self':'other'}),onReact:(id,emoji)=>reactions.push([id,emoji])});
 const pointer=(type,target=body,x=0)=>{const e=new dom.window.Event(type,{bubbles:true});Object.assign(e,{pointerType:'touch',pointerId:1,clientX:x,clientY:0});target.dispatchEvent(e)};
 const wait=()=>new Promise(r=>setTimeout(r,540));
 try{
  pointer('pointerdown');pointer('pointermove',body,20);await wait();assert.equal(document.querySelector('dialog'),null);
  pointer('pointerdown',document.querySelector('a'));pointer('pointerup');await wait();assert.equal(document.querySelector('dialog'),null);
  pointer('pointerdown');await wait();const sheet=document.querySelector('dialog');assert.ok(sheet?.open);assert.equal(!!sheet.querySelector('[data-edit]'),own);assert.equal(!!sheet.querySelector('[data-delete]'),own);
  sheet.querySelector('[data-quick]').click();assert.deepEqual(reactions,[['m','👍']]);assert.equal(document.querySelector('dialog'),null);assert.equal(document.querySelector('textarea').value,'Draft');assert.equal(document.querySelector('article'),article);
 }finally{dom.window.close();delete globalThis.document}
});
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
