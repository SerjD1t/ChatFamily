import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresence,presenceLabel} from './presence.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}

test('presence updates only status nodes; stale cache expires without claiming offline', {skip:!JSDOM},async()=>{
 const dom=new JSDOM('<div id="chatSubtitle"></div><div id="currentUserPresence"></div><div id="messages"><p>Message</p></div><textarea>Draft</textarea><small data-presence-user="peer"></small>');
 const doc=dom.window.document;Object.defineProperty(doc,'visibilityState',{value:'visible'});
 let online=true,clock=10000,fail=false;
 const messages=doc.querySelector('#messages'),message=messages.firstChild,draft=doc.querySelector('textarea');messages.scrollTop=30;
 const p=createPresence({doc,win:dom.window,now:()=>clock,user:()=> 'me',peer:()=> 'peer',request:async()=>{if(fail)throw Error('offline');return {peer:{online,lastActiveAt:'2026-09-21T12:00:00Z'}};}});
 await p.refresh();assert.equal(doc.querySelector('#chatSubtitle').textContent,'В сети');
 online=false;await p.refresh();assert.match(doc.querySelector('#chatSubtitle').textContent,/Был/);
 assert.equal(messages.firstChild,message);assert.equal(messages.scrollTop,30);assert.equal(draft.value,'Draft');
 fail=true;clock+=46000;await p.refresh();assert.equal(doc.querySelector('#chatSubtitle').textContent,'Статус недоступен');
 p.destroy();dom.window.close();
});

test('presence: user gestures only, throttling, background, polling and account change',async()=>{
 const handlers=new Map(),timers=new Map(),calls=[];let sequence=0,clock=100000,uid='one',poll;
 const slot={dataset:{presenceUser:'peer'},textContent:'',classList:{toggle(){}}};
 const doc={visibilityState:'visible',querySelectorAll:()=>[slot],querySelector:()=>null,
  addEventListener:(n,f)=>handlers.set(n,f),removeEventListener:n=>handlers.delete(n)};
 const win={addEventListener:(n,f)=>handlers.set(n,f),removeEventListener:n=>handlers.delete(n),
  setTimeout:f=>{timers.set(++sequence,f);return sequence;},clearTimeout:id=>timers.delete(id),setInterval:f=>{poll=f;return 1;},clearInterval(){}};
 let pending;
 const request=async(path)=>{calls.push(path);if(path==='/presence'){if(pending)return pending;return {peer:{online:true,lastActiveAt:null}};}};
 const p=createPresence({request,user:()=>uid,doc,win,now:()=>clock});
 const settle=()=>new Promise(r=>setImmediate(r));
 p.start();await settle();assert.equal(calls.filter(x=>x==='/me/activity').length,1);assert.equal(slot.textContent,'В сети');
 poll();await settle();assert.equal(calls.filter(x=>x==='/me/activity').length,1,'polling is not activity');
 handlers.get('input')({isTrusted:false});await settle();assert.equal(timers.size,0,'synthetic event ignored');
 handlers.get('keydown')({isTrusted:true});await settle();assert.equal(timers.size,1);
 doc.visibilityState='hidden';handlers.get('visibilitychange')();assert.equal(timers.size,0);
 handlers.get('pointerdown')({isTrusted:true});await settle();assert.equal(calls.filter(x=>x==='/me/activity').length,1);
 clock+=26000;doc.visibilityState='visible';handlers.get('visibilitychange')();await settle();assert.equal(calls.filter(x=>x==='/me/activity').length,2);
 handlers.get('input')({isTrusted:true});clock+=26000;const f=[...timers.values()][0];timers.clear();await f();await settle();assert.equal(calls.filter(x=>x==='/me/activity').length,3);
 let release;pending=new Promise(r=>release=r);const reading=p.refresh();uid='two';p.clear();release({peer:{online:true}});await reading;
 assert.notEqual(slot.textContent,'В сети','old account response ignored');
 p.destroy();assert.equal(handlers.size,0);
});

test('presence labels distinguish unknown, offline and last activity in RU/EN',()=>{
 assert.equal(presenceLabel(null),'Статус недоступен');
 assert.equal(presenceLabel({online:false}),'Не в сети');
 assert.equal(presenceLabel({online:true},'en'),'Online');
 assert.match(presenceLabel({online:false,lastActiveAt:'2026-09-21T12:00:00Z'},'en'),/^Last seen:/);
});
