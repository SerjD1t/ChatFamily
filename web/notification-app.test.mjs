import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);const {JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom');
test('cold notification renders old target, then explicit latest exits history mode',async()=>{
 const dom=new JSDOM(await readFile(new URL('./index.html',import.meta.url),'utf8'),{url:'https://example.test/#conversation=direct&message=old'});
 for(const name of ['window','document','Node','NodeFilter','Element','MutationObserver','localStorage','sessionStorage','location','history'])globalThis[name]=dom.window[name];
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};dom.window.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true'};
 globalThis.matchMedia=()=>({matches:false});globalThis.CSS={escape:value=>value};globalThis.WebSocket=class{};
 const requests=[];globalThis.fetch=async(url,options={})=>{
  const path=url.replace('/api/v1','');requests.push(path);let data=[];
  if(path==='/auth/me')data={ID:'self',Name:'Synthetic',Permissions:{}};
  else if(path==='/user/preferences')data={locale:'ru',colorScheme:'light'};
  else if(path==='/password-policy')data={minPasswordLength:12};
  else if(path==='/conversations')data=[{id:'direct',kind:'direct',title:'Synthetic other'}];
  else if(path.startsWith('/conversations/direct/messages'))data={messages:[{id:path.includes('around=old')?'old':'latest',conversationId:'direct',authorId:'self',authorName:'Synthetic author',body:'Synthetic message',createdAt:'2026-09-01T12:00:00Z',status:'read',receiptSummary:{read:1,total:1}}]};
  return {ok:true,status:200,json:async()=>structuredClone(data)};
 };
 try{
  await import('./app.js?notification-target-test');await new Promise(r=>setTimeout(r,160));
  assert.ok(requests.some(path=>path.includes('around=old')));assert.ok(document.querySelector('[data-message-id="old"].notificationTarget'));assert.ok(document.querySelector('[data-latest]'));
  document.querySelector('[data-latest]').click();await new Promise(r=>setTimeout(r,80));
  assert.ok(document.querySelector('[data-message-id="latest"]'));assert.equal(document.querySelector('[data-message-id="old"]'),null);assert.equal(document.querySelector('[data-latest]'),null);
  const bubble=document.querySelector('[data-message-id="latest"] .bubble');
  assert.ok(bubble.querySelector('.messageHeader .messageAuthor'));
  assert.ok(bubble.querySelector('.messageHeader time[datetime]'));
  assert.ok(bubble.querySelector('.messageHeader [data-status-id="latest"] .receiptInfo'));
  assert.equal(bubble.querySelector('.receiptCount'),null);
  assert.equal(bubble.querySelector('.messageMeta').closest('.messageHeader'),bubble.firstElementChild);
 }finally{dom.window.close();for(const name of ['window','document','Node','NodeFilter','Element','MutationObserver','localStorage','sessionStorage','location','history','matchMedia','CSS','WebSocket','fetch'])delete globalThis[name];}
});
