import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const code=readFileSync(new URL('./sw.js',import.meta.url),'utf8');
for(const existing of [true,false])test(`notification click routes message, open window=${existing}`,async()=>{
 const handlers={},calls=[];let work;
 const window={url:'https://example.test/',focus:async()=>calls.push('focus'),postMessage:message=>calls.push(message)};
 vm.runInNewContext(code,{URL,URLSearchParams,Promise,self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>handlers[name]=fn},clients:{matchAll:async()=>existing?[window]:[],openWindow:async url=>calls.push(url)}});
 handlers.notificationclick({notification:{data:{conversationID:'c',messageID:'m'},close:()=>{}},waitUntil:promise=>work=promise});await work;
 if(existing){assert.equal(calls[1],'focus');assert.equal(calls[0].messageID,'m');assert.equal(calls[0].conversationID,'c');}
 else{const url=new URL(calls[0]);const params=new URLSearchParams(url.hash.slice(1));assert.equal(params.get('message'),'m');assert.equal(params.get('conversation'),'c');}
});

function harness(store=new Map()){
 const handlers={},sent=[],opened=[];let windows=[];
 const cache={match:async key=>store.get(key)?.clone(),put:async(key,value)=>store.set(key,value.clone()),delete:async key=>store.delete(key)};
 const client=(id,extra={})=>({id,url:'https://example.test/',focus:async()=>{},postMessage:data=>sent.push({id,data}),...extra});
 const clients={matchAll:async()=>windows,get:async id=>windows.find(w=>w.id===id),openWindow:async url=>{opened.push(url);const c=client('new');windows.push(c);return c;},claim:async()=>{}};
 vm.runInNewContext(code,{URL,URLSearchParams,Promise,Response,Date,caches:{open:async()=>cache},self:{location:{origin:'https://example.test'},addEventListener:(n,f)=>handlers[n]=f,skipWaiting:async()=>{}},clients});
 async function event(name,data){let work;handlers[name]({...data,waitUntil:p=>work=p});await work;}
 return {sent,opened,client,setWindows:value=>windows=value,
 click:(conversationID='c')=>event('notificationclick',{notification:{data:{conversationID,messageID:'m'},close(){}}}),
 ready:c=>event('message',{source:c,data:{type:'notification.ready'}}),
 ack:(c,id)=>event('message',{source:c,data:{type:'notification.ack',requestID:id}})};
}
test('focus failure retains delivery and opens a fallback URL',async()=>{
 const h=harness(),c=h.client('old',{focus:async()=>{throw Error('suspended')}});h.setWindows([c]);await h.click();
 assert.equal(h.sent[0].data.conversationID,'c');assert.equal(h.opened.length,1);assert.match(h.opened[0],/conversation=c/);
});
test('not-ready page pulls persisted click after worker restart; ack removes it',async()=>{
 const store=new Map(),first=harness(store),c=first.client('page');first.setWindows([c]);await first.click();
 const countBefore=first.sent.length;const restarted=harness(store);restarted.setWindows([c]);await restarted.ready(c);
 assert.equal(first.sent.length,countBefore+1);
 assert.equal(restarted.sent.length,0); // Delivery uses the real source client.
 const target=first.sent.at(-1).data;assert.equal(target.conversationID,'c');
 await restarted.ack(c,target.requestID);const count=first.sent.length;await restarted.ready(c);assert.equal(first.sent.length,count);
});
test('visible client preferred; wrong-client/stale ack cannot erase a later click',async()=>{
 const h=harness(),background=h.client('bg'),visible=h.client('visible',{visibilityState:'visible'});h.setWindows([background,visible]);
 await h.click('first');assert.equal(h.sent[0].id,'visible');const old=h.sent[0].data.requestID;
 await h.click('second');await h.ack(background,h.sent.at(-1).data.requestID);await h.ack(visible,old);
 await h.ready(visible);assert.equal(h.sent.at(-1).data.conversationID,'second');
});
test('closed client hands off to recreated page; expired click is discarded',async()=>{
 const store=new Map(),h=harness(store),old=h.client('old'),fresh=h.client('fresh');h.setWindows([old]);await h.click();h.setWindows([fresh]);await h.ready(fresh);
 assert.equal(h.sent.at(-1).id,'fresh');
 const key=[...store.keys()][0],saved=await store.get(key).json();saved.clickedAt=Date.now()-600001;store.set(key,new Response(JSON.stringify(saved)));
 const count=h.sent.length;await h.ready(fresh);assert.equal(h.sent.length,count);assert.equal(store.size,0);
});
