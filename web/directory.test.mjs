import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {filterDirectory,mountDirectory} from './directory.js';
const users=[{ID:'1',Name:'Алёна Иванова',Email:'private@example.test',Permissions:{}},{ID:'2',Name:'Анна Петрова',Email:'admin@example.test',disabled:true,Permissions:{manage_application:true}}];
import {personalChatOrder} from './directory.js';
test('personal dialogs sort by latest message, then name, including self and empty contacts',()=>{
 const contacts=[{ID:'a',Name:'Alpha'},{ID:'b',Name:'Beta'},{ID:'self',Name:'Self'},{ID:'c',Name:'Charlie'}];
 const chats=[{peerUserId:'self',lastMessageAt:'2026-09-18T08:00:00Z'},{peerUserId:'b',lastMessageAt:'2026-09-18T09:00:00Z'},{peerUserId:'c',lastMessageAt:'invalid'}];
 assert.deepEqual(personalChatOrder(contacts,chats,'en').map(u=>u.ID),['b','self','a','c']);
 assert.equal(contacts[0].ID,'a');
 chats.push({peerUserId:'a',lastMessageAt:'2026-09-18T10:00:00Z'});
 assert.equal(personalChatOrder(contacts,chats,'en')[0].ID,'a');
});
test('directory searches name parts, normalizes ё and keeps emails private',()=>{
 assert.equal(filterDirectory(users,'иванова алена').length,1);assert.equal(filterDirectory(users,'private').length,0);assert.equal(filterDirectory(users,'private','','',true).length,1);
 assert.equal(filterDirectory(users,'','disabled','admin',true)[0].ID,'2');assert.equal(filterDirectory(users,'','active','member',true)[0].ID,'1');
});
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
test('directory renders 25 rows, retains search focus and restores filters on refresh',{skip:!JSDOM},()=>{
 const dom=new JSDOM('<ul id="testDirectory"></ul>');globalThis.document=dom.window.document;
 try{
 const list=document.querySelector('ul'),entries=Array.from({length:60},(_,i)=>({ID:String(i),Name:'Person '+i}));
 const args={list,users:entries,render:u=>`<li>${u.Name}</li>`};const refresh=mountDirectory(args);assert.equal(list.children.length,25);
 document.querySelector('[data-next]').click();assert.equal(list.firstElementChild.textContent,'Person 25');
 const input=document.querySelector('input');input.focus();input.value='Person 59';input.oninput();assert.equal(list.children.length,1);assert.equal(document.activeElement,input);
 refresh();assert.equal(document.querySelector('input'),input);assert.equal(document.activeElement,input);assert.equal(input.value,'Person 59');
 mountDirectory(args);assert.equal(document.querySelector('input').value,'Person 59');assert.equal(list.children.length,1);
 }finally{dom.window.close();delete globalThis.document;}
});
