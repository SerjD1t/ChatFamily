import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {openDeviceStorage} from './mobile/device-storage.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
test('device cache cleanup needs confirmation, settings are independent of pending shares',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 const data={cacheBytes:10,pendingBytes:20,freeBytes:1048576,limitMiB:200,days:7};let allow=false,clears=0,saved;
 const plugin={storageStatus:async()=>data,storageSettings:async value=>{saved=value;return{...data,...value}},clearStorageCache:async args=>{assert.equal(args.confirm,true);clears++;return{...data,cacheBytes:0}}};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 try{
  await openDeviceStorage({plugin,locale:()=> 'en',confirmAction:async()=>allow});
  document.querySelector('[data-clear]').click();await settle();assert.equal(clears,0);
  allow=true;document.querySelector('[data-clear]').click();document.querySelector('[data-clear]').click();await settle();assert.equal(clears,1);
  document.querySelector('[name=limitMiB]').value='300';document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.deepEqual(saved,{limitMiB:300,days:7});
  assert.equal(document.querySelector('[data-pending]').textContent,'0.0 MiB');
 }finally{dom.window.close();delete globalThis.document}
});
