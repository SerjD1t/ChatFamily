import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initBackupAdmin} from './backup-admin.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
test('backup panel: settings, confirmation, errors, duplicates and stable chat',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<p id="chat">History</p>',{url:'https://example.test'});globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new dom.window.Event('close'));};
 const node=document.querySelector('#chat');let fail=false,permit=false,pending=false;const calls=[];
 const settings={enabled:false,intervalHours:6,timezone:'Europe/Moscow',recentDays:2,dailyDays:30,weeklyDays:90,monthlyDays:365,limitGiB:450};
 const request=async(path,options={})=>{calls.push(options);if(options.method){await new Promise(r=>setTimeout(r,10));if(fail)throw Error('Synthetic failure');if(options.method==='POST')pending=true;return {};}
  return {settings,status:{ready:true,snapshots:[{id:'<test>',time:'2026-01-01T00:00:00Z'}],history:[]},workerStale:false,pending};};
 await initBackupAdmin({request,locale:()=> 'en',confirmAction:async()=>permit})();
 const dialog=document.querySelector('dialog'),wait=()=>new Promise(r=>setTimeout(r,30));
 assert.equal(dialog.querySelector('form button').disabled,false);
 assert.equal(dialog.querySelector('[data-snapshots] test'),null);
 dialog.querySelector('[data-action="run"]').click();await wait();assert.equal(calls.filter(o=>o.method==='POST').length,0);
 fail=true;dialog.querySelector('[name="dailyDays"]').value='25';dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await wait();
 assert.equal(dialog.querySelector('[name="dailyDays"]').value,'25');assert.equal(dialog.querySelector('[data-error]').textContent,'Synthetic failure');assert.equal(dialog.querySelector('form button').disabled,false);
 fail=false;permit=true;dialog.querySelector('[data-action="run"]').click();dialog.querySelector('[data-action="run"]').click();await wait();assert.equal(calls.filter(o=>o.method==='POST').length,1);assert.equal(dialog.querySelector('[data-action="run"]').disabled,true);
 assert.equal(document.querySelector('#chat'),node);dialog.querySelector('[data-close]').click();assert.equal(dialog.isConnected,false);dom.window.close();
});
