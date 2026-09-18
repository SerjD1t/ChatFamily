import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}

for(const mobile of [false,true])for(const saved of ['', '__personal__','direct-test']){
 test(`no family: ${mobile?'mobile':'desktop'}, ${saved||'fresh entry'}`,{skip:!JSDOM},async()=>{
  const dom=new JSDOM(await readFile(new URL('./index.html',import.meta.url),'utf8'),{url:'http://localhost/'});
  for(const name of ['window','document','Node','NodeFilter','Element','MutationObserver','localStorage','sessionStorage','location','history'])globalThis[name]=dom.window[name];
  globalThis.matchMedia=()=>({matches:mobile});globalThis.CSS={escape:value=>value};globalThis.WebSocket=class{};
  if(saved)localStorage.setItem('familychat.activeConversation',saved);
  let sent=0,failContacts=false;
  const conversation={id:'direct-test',kind:'direct',title:'Synthetic user',peerUserId:'u2'};
  const message={id:'m1',authorId:'u2',authorName:'Synthetic user',body:'Visible history',createdAt:'2026-09-17T10:00:00Z',reactions:[]};
  globalThis.fetch=async(url,options={})=>{
   const path=url.replace('/api/v1','');let data=[];
   if(path==='/auth/me')data={ID:'u1',Name:'Test',Permissions:{send_messages:true}};
   else if(path==='/user/preferences')data={locale:'ru',colorScheme:'light'};
   else if(path==='/password-policy')data={minPasswordLength:12};
   else if(path==='/conversations')data=[conversation];
   else if(path.startsWith('/contacts?')){
    if(failContacts)return {ok:false,status:503,json:async()=>({error:'Test contacts error'})};
    data=[{ID:'u1',Name:'Test'},{ID:'u2',Name:'Synthetic user'}];
   }else if(path.endsWith('/direct-conversation'))data=conversation;
   else if(path.includes('/messages?'))data={messages:[message]};
   else if(path==='/conversations/direct-test/messages'&&options.method==='POST'){sent++;data={...message,id:'sent',authorId:'u1',body:'Test message'};}
   return {ok:true,status:200,json:async()=>structuredClone(data)};
  };
  const wait=()=>new Promise(resolve=>setTimeout(resolve,40));
  await import(`./app.js?no-family-${mobile}-${saved}`);await wait();
  const $=selector=>document.querySelector(selector);
  assert.equal($('#currentFamilyTitle').textContent,'Без семьи');
  assert.equal($('#newGroup').hidden,true);assert.equal($('#manageCurrentFamily').hidden,true);
  assert.equal($('#conversations').querySelectorAll('[data-id]').length,2);
  assert.equal($('#onboarding').hidden,!!saved);assert.equal($('#messages').hidden,!saved);
  if(saved==='direct-test'){assert.ok($('[data-message-id="m1"]'));assert.equal($('#composer').hidden,false);}
  $('[data-id="__personal__"]').click();await wait();
  assert.equal($('#onboarding').hidden,true);assert.equal($('#messages').hidden,false);assert.equal($('#composer').hidden,true);
  assert.ok($('#personalDirectory [data-user-id="u1"]'));assert.ok($('#personalDirectory [data-user-id="u2"]'));
  assert.equal(document.body.classList.contains('mobileContentOpen'),mobile);
  $('#personalDirectory [data-user-id="u2"]').click();await wait();
  assert.equal($('#messages').hidden,false);assert.ok($('[data-message-id="m1"]'));assert.equal($('#composer').hidden,false);
  $('#body').value='Test message';$('#composer').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await wait();assert.equal(sent,1);
  failContacts=true;$('[data-id="__personal__"]').click();await wait();
  assert.equal($('#messages').hidden,false);assert.match($('#messages').textContent,/Test contacts error/);assert.equal($('#onboarding').hidden,true);
  $('[data-id="__shopping__"]').click();await wait();
  assert.ok($('#shoppingForm'));
  assert.equal($('#messages').hidden,false);assert.equal($('#onboarding').hidden,true);
  assert.equal($('[name=needScope]:checked').value,'personal');
  assert.equal($('[name=needScope][value=family]').disabled,true);
  assert.equal($('#composer').hidden,true);
  dom.window.close();
 });
}
