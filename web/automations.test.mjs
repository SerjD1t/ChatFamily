import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initAutomations} from './automations.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
for(const language of ['ru','en'])test(`automation settings ${language}: retry, save, duplicates and unchanged chat`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<dialog id="profile"></dialog><button id="open"></button><main><input value="chat draft"></main>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 let fail=true,release;const calls=[];const data={dailyReportEnabled:false,reportTime:'09:00',timeZone:'Europe/Moscow'};
 const request=async(path,options)=>{calls.push({path,options});if(options){await new Promise(resolve=>release=resolve);if(fail)throw Error('Synthetic save error');return JSON.parse(options.body);}if(fail)throw Error('Synthetic load error');return data;};
 const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
 try{
  const input=document.querySelector('main input');const open=initAutomations({profile:document.querySelector('#profile'),button:document.querySelector('#open'),request,locale:()=>language});
  await open();const dialog=document.querySelector('.automationDialog');assert.equal(dialog.querySelector('fieldset').disabled,true);assert.equal(dialog.querySelector('[data-retry]').hidden,false);
  fail=false;dialog.querySelector('[data-retry]').click();await tick();const form=dialog.querySelector('form');assert.equal(form.elements.dailyReportEnabled.checked,false);
  form.elements.dailyReportEnabled.checked=true;form.elements.reportTime.value='18:30';form.elements.timeZone.value='UTC';
  const submit=()=>form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  fail=true;submit();submit();assert.equal(calls.filter(c=>c.options).length,1);release();await tick();assert.equal(form.elements.reportTime.value,'18:30');assert.match(dialog.textContent,/Synthetic save error/);
  fail=false;submit();release();await tick();assert.equal(JSON.parse(calls.at(-1).options.body).dailyReportEnabled,true);assert.equal(JSON.parse(calls.at(-1).options.body).timeZone,'UTC');
  assert.equal(document.querySelector('main input'),input);assert.equal(input.value,'chat draft');dialog.querySelector('[data-close]').click();assert.equal(document.querySelector('.automationDialog'),null);
 }finally{dom.window.close();delete globalThis.document;}
});
