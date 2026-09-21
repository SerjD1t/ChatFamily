import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createReceiptDetails,receiptButton} from './receipt-details.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}

test('group receipt button shows partial reading, direct chat keeps compact marks',{skip:!JSDOM},()=>{
 const dom=new JSDOM('');globalThis.document=dom.window.document;
 try {
 assert.match(receiptButton('one','sent',{read:1,total:3},true),/Прочитали 1 из 3/);
 assert.doesNotMatch(receiptButton('one','read',{read:1,total:1},false),/receiptCount/);
 assert.match(receiptButton('one','delivered',{read:0,total:3},true,'en'),/Read 0 of 3/);
 document.body.innerHTML=receiptButton('one','read',{read:1,total:3},true);
 assert.equal(document.querySelector('.receiptCount').textContent,'1/3');
 assert.match(document.querySelector('button').getAttribute('aria-label'),/Прочитали 1 из 3/);
 assert.equal(document.querySelector('.messageStatus').getAttribute('aria-hidden'),'true');
 assert.doesNotMatch(receiptButton('\"><img>','sent',null,true),/<img>/);
 }finally{dom.window.close();delete globalThis.document;}
});

test('receipt details show times, handle errors and ignore late responses after close',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<button id="opener">Info</button><article>Unchanged history</article>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 let mode='success',resolveLate;
 const payload={recipients:[{userId:'r',name:'<img onerror=x>',deliveredAt:'2026-09-17T09:00:00Z',readAt:'2026-09-17T09:01:00Z'},{userId:'d',name:'Delivered',deliveredAt:'2026-09-17T09:00:00Z'},{userId:'n',name:'Pending'}]};
 const ui=createReceiptDetails({request:async()=>{if(mode==='late')return new Promise(resolve=>resolveLate=resolve);if(mode==='error')throw new Error('Unavailable');return payload;}});
 try{
  const opener=document.querySelector('button'),article=document.querySelector('article');ui.open('one',opener);await settle();
  assert.equal(document.querySelectorAll('.receiptDialog li').length,3);assert.equal(document.querySelector('.receiptDialog img'),null);
  assert.match(document.querySelector('.receiptDialog').textContent,/Прочитали \(1\)/);assert.match(document.querySelector('.receiptDialog').textContent,/текущий состав/);
  const row=document.querySelector('[data-id=r]');await ui.refresh();assert.equal(document.querySelector('[data-id=r]'),row);
  mode='error';await ui.refresh();assert.equal(document.querySelectorAll('.receiptDialog li').length,0);assert.match(document.querySelector('[data-error]').textContent,/Unavailable/);
  mode='late';const pending=ui.refresh();ui.close();resolveLate(payload);await pending;assert.equal(document.querySelector('dialog'),null);assert.equal(document.activeElement,opener);assert.equal(document.querySelector('article'),article);
 }finally{ui.close();dom.window.close();delete globalThis.document;}
});
