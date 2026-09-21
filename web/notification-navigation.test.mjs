import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {initNotificationNavigation,notificationTarget} from './notification-navigation.js';
const require=createRequire(import.meta.url);const {JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom');
test('notification target is validated',()=>{
 assert.equal(notificationTarget({conversationID:123}),null);assert.equal(notificationTarget({conversationID:'x',messageID:123}),null);
 assert.deepEqual(notificationTarget({conversationID:'x',messageID:'m'}),{conversationID:'x',messageID:'m'});
});
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
