import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
test('update entry, automatic resume checks, manual retry and no chat redraw',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<button id="openUserMenu"></button><dialog id="userMenuDialog"><button id="myProfile"></button></dialog><main><input value="draft"></main>');
 globalThis.document=dom.window.document;dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 let visibility='visible';Object.defineProperty(document,'visibilityState',{get:()=>visibility});
 const calls=[],errors=[];let language='ru',fail=false;
 const plugin={status:async()=>({versionName:'0.5.0'}),check:async options=>{calls.push(options);if(fail)throw Error('Synthetic');}};
 const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
 try {
  const {initAppUpdate}=await import('./mobile/app-update.js');
  const input=document.querySelector('input');initAppUpdate({locale:()=>language,announce:(...args)=>errors.push(args),plugin});await tick();
  const button=document.querySelector('.appUpdateButton');assert.match(button.textContent,/0.5.0/);assert.equal(calls[0].manual,false);
  visibility='hidden';document.dispatchEvent(new dom.window.Event('visibilitychange'));await tick();assert.equal(calls.length,1);
  visibility='visible';document.dispatchEvent(new dom.window.Event('visibilitychange'));await tick();assert.equal(calls.length,2);
  language='en';document.querySelector('#openUserMenu').click();assert.match(button.textContent,/Check updates/);
  fail=true;button.click();await tick();assert.equal(calls[2].manual,true);assert.equal(calls[2].locale,'en');assert.equal(errors.length,1);assert.equal(button.disabled,false);
  assert.equal(document.querySelector('input'),input);assert.equal(input.value,'draft');
 }finally{dom.window.close();delete globalThis.document;}
});
