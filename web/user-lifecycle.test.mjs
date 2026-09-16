import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import {initUserLifecycle} from './user-lifecycle.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
test('account deletion requires exact email and prevents duplicate submissions',{skip:!JSDOM},async()=>{
 const dom=new JSDOM(readFileSync(new URL('./index.html',import.meta.url),'utf8'));globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 let calls=0,finish,changed=0;const open=initUserLifecycle({locale:()=> 'en',announce:()=>{},onChanged:async()=>changed++,request:async(path,options)=>{calls++;assert.equal(path,'/users/u1/lifecycle');assert.deepEqual(JSON.parse(options.body),{action:'delete',email:'test@example.test'});await new Promise(r=>finish=r);}});
 try {open({ID:'u1',Name:'Test',Email:'test@example.test'},'delete');const form=document.querySelector('#userLifecycleForm'),email=document.querySelector('#userLifecycleEmail'),e={preventDefault(){}};
 email.value='wrong@example.test';await form.onsubmit(e);assert.equal(calls,0);
 email.value='test@example.test';const pending=form.onsubmit(e);await form.onsubmit(e);assert.equal(calls,1);finish();await pending;assert.equal(changed,1);assert.equal(document.querySelector('#userLifecycleDialog').open,false);
 }finally{dom.window.close();delete globalThis.document;}
});
