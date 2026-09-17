import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}

test('mobile: reopen retained chats and needs, without background navigation or replacing history', {skip:!JSDOM}, async()=>{
 const dom=new JSDOM(await readFile(new URL('./index.html',import.meta.url),'utf8'),{url:'http://localhost/'});
 for(const name of ['window','document','Node','NodeFilter','Element','MutationObserver','localStorage','sessionStorage','location','history'])globalThis[name]=dom.window[name];
 globalThis.matchMedia=()=>({matches:true});globalThis.CSS={escape:value=>value};
 let socket;globalThis.WebSocket=class{constructor(){socket=this;}};
 const conversations=['family','group','direct'].map(kind=>({id:kind,kind,familyId:kind==='direct'?undefined:'f1',title:'Synthetic '+kind}));
 globalThis.fetch=async(url)=>{
  const path=url.replace('/api/v1','');let data=[];
  if(path==='/auth/me')data={ID:'u1',Name:'Test',Permissions:{}};
  else if(path==='/families')data=[{id:'f1',title:'Test family',role:'owner'}];
  else if(path==='/user/preferences')data={locale:'ru',colorScheme:'light'};
  else if(path==='/password-policy')data={minPasswordLength:12};
  else if(path==='/conversations')data=conversations;
  else if(path.includes('/messages?'))data={messages:[{id:'m1',authorId:'u2',authorName:'Test',body:'History',createdAt:'2026-09-17T10:00:00Z',reactions:[]}]};
  else if(path.startsWith('/contacts?'))data=[{ID:'u2',Name:'Test'}];
  else if(path.endsWith('/direct-conversation'))data=conversations[2];
  return {ok:true,status:200,json:async()=>structuredClone(data)};
 };
 const wait=()=>new Promise(r=>setTimeout(r,180)), $=s=>document.querySelector(s);
 const visible=()=>document.body.classList.contains('mobileContentOpen');
 try{
  await import('./app.js?mobile-navigation');await wait();
  for(const id of ['family','group']){
   $(`[data-id="${id}"]`).click();await wait();
   const article=$('[data-message-id="m1"]');assert.ok(article);
   $('#body').value='Draft';
   $('.mobileBack').click();assert.equal(visible(),false);
   await socket.onmessage({data:JSON.stringify({type:'message.updated',conversationId:id,messageId:'m1'})});await wait();
   assert.equal(visible(),false,'background refresh must leave list visible');
   $(`[data-id="${id}"]`).click();
   assert.equal(visible(),true,'same chat must open immediately');await wait();
   assert.equal($('[data-message-id="m1"]'),article);assert.equal($('#body').value,'Draft');
  }
  $('[data-id="__shopping__"]').click();await wait();assert.ok($('#shoppingForm'));
  const form=$('#shoppingForm');$('.mobileBack').click();
  await socket.onmessage({data:JSON.stringify({type:'shopping.changed'})});await wait();
  assert.equal(visible(),false,'background needs refresh must leave list visible');
  $('[data-id="__shopping__"]').click();assert.equal(visible(),true);await wait();
  assert.equal($('#shoppingForm'),form);
 }finally{dom.window.close();}
});
