import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
for(const role of ['owner','admin']) test(`family editor: ${role}, cancel, retry, duplicate protection and compact list`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM(await readFile(new URL('./index.html',import.meta.url),'utf8'),{url:'http://localhost/'});
 for(const name of ['window','document','Node','NodeFilter','Element','MutationObserver','localStorage','sessionStorage','location','history']) globalThis[name]=dom.window[name];
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 globalThis.matchMedia=()=>({matches:false});globalThis.CSS={escape:value=>value};globalThis.WebSocket=class{};
 let fail=true,patches=0,payload;
 globalThis.fetch=async(url,options={})=>{
  const path=url.replace('/api/v1','');let data=[];
  if(path==='/auth/me')data={ID:'u1',Name:'Tester',Permissions:{}};
  else if(path==='/families')data=[{id:'f1',title:'Test family',role}];
  else if(path==='/user/preferences')data={locale:'ru',colorScheme:'light'};
  else if(path==='/conversations')data=[{id:'c1',kind:'family',familyId:'f1',title:'Test family'}];
  else if(path.includes('/messages?'))data={messages:[]};
  else if(path==='/conversations/c1/members')data=[{ID:'u2',Name:'Test Member',familyRole:'member',familyRelationship:'Relative',familyCategories:['relative']}];
  else if(path==='/families/f1/members/u2'){
   patches++;payload=JSON.parse(options.body);await new Promise(resolve=>setTimeout(resolve,10));
   if(fail)return {ok:false,status:403,json:async()=>({error:'Test error'})};
   data={};
  }
  return {ok:true,status:200,json:async()=>structuredClone(data)};
 };
 await import(`./app.js?family-editor-${role}`);
 const wait=()=>new Promise(resolve=>setTimeout(resolve,40));await wait();
 const $=selector=>document.querySelector(selector);
 $('#manageCurrentFamily').click();await wait();
 assert.ok($('#familyAdminDialog').open);
 assert.equal($('#familyMembers input'),null);assert.equal($('#familyBulkEdit'),null);
 $('[data-edit-family-user]').click();
 assert.equal($('#familyMemberEditRole').disabled,role!=='owner');
 $('#familyMemberEditStatus').value='Discard this';$('#cancelFamilyMemberEdit').click();
 assert.equal(patches,0);$('[data-edit-family-user]').click();assert.equal($('#familyMemberEditStatus').value,'Relative');
 $('#familyMemberEditStatus').value='New status';$('#familyMemberEditRole').value='admin';
 $('#familyMemberSearch').value='Test';
 const submit=()=>$('#familyMemberEditForm').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 submit();submit();await wait();
 assert.equal(patches,1);assert.equal(payload.role,role==='owner'?'admin':'member');
 assert.ok($('#familyMemberEditDialog').open);assert.equal($('#familyMemberEditStatus').value,'New status');
 assert.equal($('#familyMemberEditError').textContent,'Test error');assert.equal($('#familyMembers').textContent.includes('New status'),false);
 fail=false;submit();await wait();
 assert.equal(patches,2);assert.equal($('#familyMemberEditDialog').open,false);
 assert.ok($('#familyMembers').textContent.includes('New status'));assert.equal($('#familyMemberSearch').value,'Test');
 dom.window.close();
});
