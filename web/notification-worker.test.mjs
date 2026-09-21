import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const code=readFileSync(new URL('./sw.js',import.meta.url),'utf8');
for(const existing of [true,false])test(`notification click routes message, open window=${existing}`,async()=>{
 const handlers={},calls=[];let work;
 const window={url:'https://example.test/',focus:async()=>calls.push('focus'),postMessage:message=>calls.push(message)};
 vm.runInNewContext(code,{URL,URLSearchParams,Promise,self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>handlers[name]=fn},clients:{matchAll:async()=>existing?[window]:[],openWindow:async url=>calls.push(url)}});
 handlers.notificationclick({notification:{data:{conversationID:'c',messageID:'m'},close:()=>{}},waitUntil:promise=>work=promise});await work;
 if(existing){assert.equal(calls[0],'focus');assert.equal(calls[1].messageID,'m');assert.equal(calls[1].conversationID,'c');}
 else{const url=new URL(calls[0]);const params=new URLSearchParams(url.hash.slice(1));assert.equal(params.get('message'),'m');assert.equal(params.get('conversation'),'c');}
});
