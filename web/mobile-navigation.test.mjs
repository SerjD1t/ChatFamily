import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}

for (const mobile of [true,false]) test(`${mobile?'mobile':'desktop'}: retained chats and needs, family switching without replacing personal content`, {skip:!JSDOM}, async()=>{
 const dom=new JSDOM(await readFile(new URL('./index.html',import.meta.url),'utf8'),{url:'http://localhost/'});
 for(const name of ['window','document','Node','NodeFilter','Element','MutationObserver','localStorage','sessionStorage','location','history'])globalThis[name]=dom.window[name];
 globalThis.matchMedia=()=>({matches:mobile});globalThis.CSS={escape:value=>value};
 let socket;globalThis.WebSocket=class{constructor(){socket=this;}};
 const conversations=['family','group','direct'].map(kind=>({id:kind,kind,familyId:kind==='direct'?undefined:'f1',title:'Synthetic '+kind}));
 conversations.push({id:'family2',kind:'family',familyId:'f2',title:'Second family chat'});
 const calls=[];
 globalThis.fetch=async(url)=>{
  const path=url.replace('/api/v1','');let data=[];
  calls.push(path);
  if(path==='/auth/me')data={ID:'u1',Name:'Test',Permissions:{}};
  else if(path==='/families')data=[{id:'f1',title:'Test family',role:'owner'},{id:'f2',title:'Other family',role:'member'}];
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
  await import(`./app.js?mobile-navigation-${mobile}`);await wait();
  const switchFamily=async id=>{$('#familySelect').value=id;$('#familySelect').dispatchEvent(new dom.window.Event('change'));await wait();};
  assert.equal($('#familySelect').hidden,false);assert.equal($('#familySelect').options.length,2);
  for(const id of ['family','group']){
   $(`[data-id="${id}"]`).click();await wait();
   const article=$('[data-message-id="m1"]');assert.ok(article);
   $('#body').value='Draft';
   $('.mobileBack').click();assert.equal(visible(),false);
   await socket.onmessage({data:JSON.stringify({type:'message.updated',conversationId:id,messageId:'m1'})});await wait();
   assert.equal(visible(),false,'background refresh must leave list visible');
   $(`[data-id="${id}"]`).click();
   assert.equal(visible(),mobile,'same chat must open immediately');await wait();
   assert.equal($('[data-message-id="m1"]'),article);assert.equal($('#body').value,'Draft');
  }
  $('[data-id="__shopping__"]').click();await wait();assert.ok($('#shoppingForm'));
  const form=$('#shoppingForm');$('.mobileBack').click();
  await socket.onmessage({data:JSON.stringify({type:'shopping.changed'})});await wait();
  assert.equal(visible(),false,'background needs refresh must leave list visible');
  $('[data-id="__shopping__"]').click();assert.equal(visible(),mobile);await wait();
  assert.equal($('#shoppingForm'),form);
  assert.equal($('[name=needScope]'),null);
  const privateForm=$('#shoppingForm');privateForm.elements.title.value='Private draft';
  $('#familySelect').value='f2';$('#familySelect').dispatchEvent(new dom.window.Event('change'));await wait();
  assert.equal($('#shoppingForm'),privateForm);assert.equal(privateForm.elements.title.value,'Private draft');
  assert.equal($('[name=createScope]').value,'personal');
  await socket.onmessage({data:JSON.stringify({type:'shopping.changed'})});await wait();
  assert.equal($('#shoppingForm'),privateForm);
  assert.equal($('#shoppingForm'),privateForm);
  await switchFamily('f1');
  assert.ok($('#shoppingForm'));assert.equal($('[name=createScope]').value,'personal');
  assert.equal($('#chatSubtitle').textContent,'Test family');assert.ok(calls.includes('/families/f1/needs'));
  await switchFamily('f2');assert.ok($('#shoppingForm'));assert.equal($('#chatSubtitle').textContent,'Other family');
  assert.ok(calls.includes('/families/f2/needs'));assert.equal($('#manageCurrentFamily').hidden,true);
  $('[data-id="family2"]').click();await wait();
  await switchFamily('f1');assert.equal($('#messages').dataset.conversationId,'family');
  assert.equal($('#manageCurrentFamily').hidden,false);
  await switchFamily('f2');assert.equal($('#messages').dataset.conversationId,'family2');
  await switchFamily('f1');$('[data-id="group"]').click();await wait();
  await switchFamily('f2');assert.equal($('#messages').dataset.conversationId,'family2');
  $('[data-id="__personal__"]').click();await wait();
  const directory=$('#personalDirectory');await switchFamily('f1');assert.equal($('#personalDirectory'),directory);
  $('#personalDirectory [data-user-id="u2"]').click();await wait();
  const directArticle=$('[data-message-id="m1"]');$('#body').value='Direct draft';
  await switchFamily('f2');assert.equal($('#messages').dataset.conversationId,'direct');
  assert.equal($('[data-message-id="m1"]'),directArticle);assert.equal($('#body').value,'Direct draft');
 }finally{dom.window.close();}
});
