import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initInterfamily} from './interfamily.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
for(const locale of ['ru','en'])test(`interfamily workflow ${locale}: explicit representatives, approval, retries and retained chat`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<body><textarea id="draft">Keep this</textarea></body>',{url:'https://example.test'});globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};
 let writes=[],fail=false,confirmed=0,refreshes=0;
 const c={id:'c',title:'Synthetic " autofocus onfocus="bad',originId:'f',originTitle:'Source',targetId:'t',targetTitle:'Target',members:['r'],version:2,state:'requested'};
 const request=async(path,opt)=>{if(opt){writes.push({path,body:JSON.parse(opt.body)});if(fail)throw Error('Synthetic error');return{id:'c',token:path==='/interfamily'?'test-code':undefined}};if(path.includes('candidates=1'))return[{ID:'a',Name:'Admin'},{ID:'r',Name:'Representative'}];return[c]};
 const ui=initInterfamily({request,family:()=>({id:'f',title:'Source',role:'admin'}),locale:()=>locale,refresh:async()=>refreshes++,confirm:async()=>{confirmed++;return true}});
 const $=s=>document.querySelector(s),wait=()=>new Promise(r=>setTimeout(r,15));
 try{
  await ui.open();$('[data-create]').click();let child=document.querySelectorAll('dialog')[1],form=child.querySelector('form');
  assert.equal(form.querySelectorAll(':checked').length,1,'only default icon selected; no representatives automatically included');
  form.elements.title.value='New';form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await wait();assert.equal(writes.length,0);
  form.querySelector('[value=r]').checked=true;fail=true;form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await wait();assert.match(child.querySelector('.error').textContent,/Synthetic/);assert.equal(form.elements.title.value,'New');const key=writes[0].body.requestKey;
  fail=false;form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await wait();assert.equal(writes[1].body.requestKey,key);assert.deepEqual(writes[1].body.members,['r']);
  document.querySelectorAll('dialog')[1].querySelector('[data-close]').click();
  $('[data-edit]').click();child=document.querySelectorAll('dialog')[1];assert.equal(child.querySelector('[autofocus]'),null);assert.equal(child.querySelector('[name=title]').value,c.title);
  child.querySelector('[data-approve]').click();await wait();assert.equal(confirmed,1);assert.equal(writes.at(-1).path,'/interfamily/c/approve');assert.equal(writes.at(-1).body.version,2);
  assert.equal($('#draft').value,'Keep this');assert.equal(refreshes,2);
 }finally{dom.window.close()}
});
