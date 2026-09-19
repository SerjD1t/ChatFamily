import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {classifyGroups,initGroups,managesGroup} from './groups.js';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
test('groups classification is exclusive and only presentation',()=>{
 const groups=[{id:'a',kind:'group',familyIds:['f1','f2']},{id:'b',kind:'group',familyIds:[]},{id:'c',kind:'family',familyId:'f1'}];
 assert.deepEqual(classifyGroups(groups,'f1'),{family:[groups[0]],other:[groups[1]]});
 assert.deepEqual(classifyGroups(groups,''),{family:[],other:groups.slice(0,2)});
 assert.equal(managesGroup({groupRole:'admin'}),true);assert.equal(managesGroup({groupRole:'member'}),false);
});
for(const locale of ['ru','en'])for(const role of ['owner','admin','member'])test(`group settings ${locale}/${role}`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<body><textarea id="draft">Retained draft</textarea></body>',{url:'https://example.test'});globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};
 const members=[{ID:'o',Name:'Owner',groupRole:'owner'},{ID:'a',Name:'Admin',groupRole:'admin'},{ID:'m',Name:'Member',groupRole:'member'},{ID:'d',Name:'Disabled',groupRole:'member',disabled:true}];
 const c={id:'g',title:'Synthetic <group>',kind:'group',groupRole:role,canInvite:role!=='member',icon:'🎮'};const writes=[];let refreshes=0;
 const request=async(path,options)=>{if(options){writes.push({path,body:JSON.parse(options.body)});return;}if(path==='/conversations')return[c];if(path.endsWith('/members'))return members;if(path.endsWith('/member-candidates'))return[{ID:'x',Name:'Outsider'}];throw Error('unexpected '+path)};
 const ui=initGroups({request,locale:()=>locale,refresh:async()=>refreshes++,announce:()=>{},confirm:async()=>true});
 const $=s=>document.querySelector(s),wait=()=>new Promise(r=>setTimeout(r,10));
 try{await ui.open(c);assert.equal(!!$('[data-settings]'),role!=='member');assert.equal(!!$('[data-invite]'),role!=='member');assert.equal(!!$('[data-leave]'),role!=='owner');assert.equal($('[data-edit="o"]'),null);assert.equal(!!$('[data-edit="a"]'),role==='owner');
  if(role!=='member'){
   $('[data-edit="d"]').click();assert.equal($('[data-transfer]'),null);document.querySelectorAll('[data-close]')[1].click();
   $('[data-edit="m"]').click();const f=document.querySelectorAll('.groupSettingsDialog')[1].querySelector('form');assert.equal(f.elements.role.disabled,role!=='owner');f.elements.invite.checked=true;f.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await wait();assert.equal(writes[0].path,'/groups/g/permissions');assert.equal(writes[0].body.canInvite,true);assert.equal(refreshes,1);
   $('[data-invite]').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await wait();assert.equal(writes[1].body.userId,'x');
  }
  assert.equal($('#draft').value,'Retained draft');
 }finally{dom.window.close()}
});
