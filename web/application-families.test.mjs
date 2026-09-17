import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initApplicationFamilies} from './application-families.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
test('global family management: search, separate editor, confirmation, retry and membership operations',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<p id="chat">Existing chat</p>',{url:'https://example.test'});globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const chat=document.querySelector('#chat');let permit=false,fail=false,writes=0;const calls=[];
 const member={id:'u1',name:'Synthetic <Member>',role:'member',relationship:'Relative',categories:['relative'],disabled:false};
 const request=async(path,options={})=>{
  calls.push([path,options]);if(options.method){writes++;await new Promise(r=>setTimeout(r,10));if(fail)throw Error('Test failure');return;}
  if(path.includes('/candidates?'))return {items:[{...member,id:'u2'}],total:1};
  if(path.includes('/members?'))return {items:[member],total:1};
  return {items:[{id:'f1',title:'Synthetic <Family>',members:1,owners:['Owner'],archived:false}],total:30};
 };
 await initApplicationFamilies({request,locale:()=> 'en',confirmAction:async()=>permit})();
 const root=document.querySelector('dialog');root.querySelector('[data-search]').value='Sample';root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 const wait=()=>new Promise(r=>setTimeout(r,35));await wait();assert.ok(calls.at(-1)[0].includes('q=Sample'));
 root.querySelector('[data-next]').click();await wait();assert.ok(calls.at(-1)[0].includes('offset=25'));
 root.querySelector('[data-family]').click();await wait();const family=document.querySelectorAll('dialog')[1];
 assert.equal(family.querySelector('[data-list] input'),null);family.querySelector('[data-user]').click();
 let editor=document.querySelectorAll('dialog')[2];assert.equal(editor.querySelector('h3').textContent,member.name);assert.equal(editor.querySelector('h3 Member'),null);
 editor.querySelector('[data-remove]').click();await wait();assert.equal(writes,0);assert.ok(editor.open);
 permit=true;fail=true;editor.querySelector('[name="relationship"]').value='Draft';
 const submit=()=>editor.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));submit();submit();await wait();assert.equal(writes,1);assert.ok(editor.open);assert.equal(editor.querySelector('[name="relationship"]').value,'Draft');assert.equal(editor.querySelector('[data-error]').textContent,'Test failure');
 fail=false;submit();await wait();assert.equal(writes,2);assert.equal(editor.isConnected,false);
 family.querySelector('[data-add]').click();await wait();const candidates=document.querySelectorAll('dialog')[2];candidates.querySelector('[data-candidate]').click();editor=document.querySelectorAll('dialog')[2];submit();await wait();
 assert.ok(calls.some(([path,o])=>path.endsWith('/members/u2')&&o.method==='PUT'));
 family.querySelector('[data-user]').click();editor=document.querySelectorAll('dialog')[2];editor.querySelector('[data-remove]').click();await wait();
 assert.ok(calls.some(([path,o])=>path.endsWith('/members/u1')&&o.method==='DELETE'));
 assert.equal(document.querySelector('#chat'),chat);assert.ok(calls.every(([path])=>path.startsWith('/application/families')));dom.window.close();
});
