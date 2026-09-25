import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {initNotificationNavigation,notificationTarget} from './notification-navigation.js';
const require=createRequire(import.meta.url);const {JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom');
test('notification target is validated',()=>{
 assert.equal(notificationTarget({conversationID:123}),null);assert.equal(notificationTarget({conversationID:'x',messageID:123}),null);
 assert.deepEqual(notificationTarget({conversationID:'x',messageID:'m'}),{conversationID:'x',messageID:'m'});
});

async function scenario(run){
 const dom=new JSDOM('',{url:'https://example.test/'}),originalNavigator=globalThis.navigator,originalTimer=globalThis.setTimeout;
 const posted=[],listeners={},scheduled=[];
 for(const key of ['location','history','sessionStorage'])globalThis[key]=dom.window[key];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{controller:{postMessage:m=>posted.push(m)},addEventListener:(n,f)=>listeners[n]=f}}});
 globalThis.setTimeout=(fn,delay)=>{if(delay>=1000){scheduled.push({fn,delay});return {unref(){}};}return originalTimer(fn,delay);};
 try{await run({posted,listeners,scheduled});}finally{globalThis.setTimeout=originalTimer;dom.window.close();for(const key of ['location','history','sessionStorage'])delete globalThis[key];Object.defineProperty(globalThis,'navigator',{configurable:true,value:originalNavigator});}
}
test('network failure retains routing until success, acknowledges once and deduplicates',()=>scenario(async({posted,scheduled})=>{
 let calls=0;const nav=initNotificationNavigation({ready:()=>true,open:async()=>{if(++calls===1)throw Error('offline');},onError:()=>{}});
 const target={conversationID:'c',messageID:'m',requestID:'click1',clickedAt:Date.now()};await nav.receive(target);
 assert.ok(sessionStorage.getItem('notification.pending'));assert.equal(posted.length,0);assert.equal(scheduled[0].delay,1000);
 await nav.flush();assert.equal(sessionStorage.getItem('notification.pending'),null);assert.equal(posted[0].type,'notification.ack');
 await nav.receive(target);assert.equal(calls,2);
}));
test('latest click supersedes in-flight open; late old result cannot acknowledge new click',()=>scenario(async({posted})=>{
 let release,oldCurrent;const calls=[];
 const nav=initNotificationNavigation({ready:()=>true,open:async(target,isCurrent)=>{calls.push(target.conversationID);if(target.conversationID==='old'){oldCurrent=isCurrent;await new Promise(r=>release=r);}},onError:()=>{}});
 const now=Date.now();const first=nav.receive({conversationID:'old',requestID:'a',clickedAt:now});
 await nav.receive({conversationID:'new',requestID:'b',clickedAt:now+1});assert.equal(oldCurrent(),false);
 release();await first;await Promise.resolve();await Promise.resolve();
 assert.deepEqual(calls,['old','new']);assert.deepEqual(posted.map(p=>p.requestID),['b']);
 await nav.receive({conversationID:'old',requestID:'a',clickedAt:now});assert.equal(calls.length,2);
}));
test('terminal access failure clears target; retries are bounded for temporary failure',()=>scenario(async({scheduled})=>{
 const denied=initNotificationNavigation({ready:()=>true,open:async()=>{throw Object.assign(Error('denied'),{status:403})},onError:()=>{}});
 await denied.receive({conversationID:'c'});assert.equal(sessionStorage.getItem('notification.pending'),null);assert.equal(scheduled.length,0);
 let calls=0;const offline=initNotificationNavigation({ready:()=>true,open:async()=>{calls++;throw Error('offline')},onError:()=>{}});
 await offline.receive({conversationID:'c'});
 for(let i=0;i<3;i++)await offline.flush();assert.equal(calls,4);assert.equal(scheduled.length,3);assert.ok(sessionStorage.getItem('notification.pending'));
}));
test('cold notification waits for login and survives navigation',async()=>{
 const dom=new JSDOM('',{url:'https://example.test/#conversation=c&message=m'});const originalNavigator=globalThis.navigator;
 for(const key of ['location','history','sessionStorage'])globalThis[key]=dom.window[key];Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
 let ready=false;const calls=[];
 try{
  const options={ready:()=>ready,open:async target=>calls.push(target),onError:()=>assert.fail('unexpected error')};
  const first=initNotificationNavigation(options);await first.flush();assert.equal(calls.length,0);
  history.replaceState(null,'','/');const afterLogin=initNotificationNavigation(options);ready=true;await afterLogin.flush();
  assert.deepEqual(calls,[{conversationID:'c',messageID:'m'}]);assert.equal(sessionStorage.getItem('notification.pending'),null);
  await afterLogin.receive({conversationID:'c',messageID:'next'});assert.equal(calls[1].messageID,'next');
 }finally{dom.window.close();for(const key of ['location','history','sessionStorage'])delete globalThis[key];Object.defineProperty(globalThis,'navigator',{configurable:true,value:originalNavigator});}
});
