import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {splitChecklist,mountChecklist} from './need-checklist.js';
test('comma conversion preserves decimals and trims empty entries',()=>{
 assert.deepEqual(splitChecklist(' Milk 1,5 l, bread,,\n eggs\r\n '),['Milk 1,5 l','bread','eggs']);
 assert.deepEqual(splitChecklist(''),[]);
});
test('failed checks keep saved state and all checked offers completion explicitly',async()=>{
 const require=createRequire(import.meta.url);const {JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom');const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 const item={kind:'purchase',checklist:[{id:'a',text:'Bread',completed:false}]},host=document.querySelector('main');let fail=true;const calls=[];
 mountChecklist({host,item,editable:false,t:(ru,en)=>en,save:async body=>{calls.push(body);if(fail)throw Error('Conflict');if(body.checkItem)item.checklist[0].completed=true;if(body.completed)item.completedAt='now';}});
 const tick=()=>new Promise(r=>setTimeout(r,0));host.querySelector('input').click();await tick();
 assert.equal(host.querySelector('input').checked,false);assert.equal(host.querySelector('[role=alert]').textContent,'Conflict');
 fail=false;host.querySelector('input').click();await tick();assert.equal(item.completedAt,undefined);
 host.querySelector('button').click();await tick();assert.equal(calls.at(-1).completed,true);assert.equal(item.completedAt,'now');dom.window.close();delete globalThis.document;
});
test('preview is reversible, saves original and checks explicit state',async()=>{
 const require=createRequire(import.meta.url);const {JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom');
 const dom=new JSDOM('<div id="host"></div>');globalThis.document=dom.window.document;
 const host=document.querySelector('#host'),item={title:'Milk, Bread',kind:'purchase',version:1};const calls=[];
 mountChecklist({host,item,editable:true,t:(ru,en)=>en,save:async body=>{calls.push(body);if(body.checklist)item.checklist=body.checklist.map((e,i)=>({...e,id:String(i)}));if(body.checkItem)item.checklist.find(e=>e.id===body.checkItem.id).completed=body.checkItem.completed;}});
 const click=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text).click();
 click('Make checklist');assert.equal(host.querySelectorAll('input[type=text]').length,2);click('Cancel');assert.equal(calls.length,0);
 click('Make checklist');host.querySelector('input[type=text]').value='Milk 1,5 l';click('Save checklist');await new Promise(r=>setTimeout(r,0));
 assert.equal(calls[0].checklistSource,'Milk, Bread');assert.equal(calls[0].checklist[0].text,'Milk 1,5 l');
 host.querySelector('input[type=checkbox]').click();await new Promise(r=>setTimeout(r,0));assert.deepEqual(calls[1],{checkItem:{id:'0',completed:true}});
 assert.equal(item.completedAt,undefined);dom.window.close();delete globalThis.document;
});
