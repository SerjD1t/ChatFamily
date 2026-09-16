import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initStorageAdmin} from './storage-admin.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
test('storage requires explicit confirmation and preserves settings draft on refresh',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new dom.window.Event('close'))};
 let allow=false;const calls=[];const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 const data={settings:{images:true,videos:true,pdfs:true,cacheDays:30,orphanDays:30,trashDays:30},originals:{count:1,bytes:1024},cache:{count:1,bytes:10},trash:{count:0,bytes:0},candidates:{cache:{count:1,bytes:10}},history:[],tools:{ffmpeg:true},ignored:0,maxUploadBytes:1048576};
 const request=async(path,options)=>{calls.push({path,options});if(path.endsWith('/plan'))return{token:'one-shot',total:{count:1,bytes:10}};if(path.endsWith('/execute'))return{count:1,bytes:10};return data};
 try{
  await initStorageAdmin({request,locale:()=> 'en',confirmAction:async()=>allow})();
  const field=document.querySelector('[name=cacheDays]');field.value='90';document.querySelector('[data-refresh]').click();await settle();assert.equal(field.value,'90');
  document.querySelector('[data-action=cache]').click();await settle();assert.equal(calls.filter(c=>c.path.endsWith('/execute')).length,0);
  allow=true;document.querySelector('[data-action=cache]').click();document.querySelector('[data-action=cache]').click();await settle();
  const executed=calls.filter(c=>c.path.endsWith('/execute'));assert.equal(executed.length,1);assert.deepEqual(JSON.parse(executed[0].options.body),{token:'one-shot',confirm:true});
 }finally{dom.window.close();delete globalThis.document}
});
