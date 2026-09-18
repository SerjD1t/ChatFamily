import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}
for(const locale of ['ru','en'])test(`separate application users panel (${locale})`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM(await readFile(new URL('./index.html',import.meta.url),'utf8'),{url:'http://localhost/'});
 for(const name of ['window','document','Node','NodeFilter','Element','MutationObserver','localStorage','sessionStorage','location','history'])globalThis[name]=dom.window[name];
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 globalThis.matchMedia=()=>({matches:false});globalThis.CSS={escape:value=>value};globalThis.WebSocket=class{};
 let userReads=0,settingsReads=0,writes=0,fail=false;
 const users=[{ID:'u1',Name:'Test Admin',Email:'admin@example.test',Permissions:{manage_application:true}},{ID:'u2',Name:'Synthetic Member',Email:'member@example.test',Permissions:{send_messages:true}}];
 globalThis.fetch=async(url,options={})=>{
  const p=url.replace('/api/v1','');let data=[];
  if(p==='/auth/me')data=users[0];
  else if(p==='/user/preferences')data={locale,colorScheme:'light'};
  else if(p==='/password-policy')data={minPasswordLength:12};
  else if(p==='/application/settings'){settingsReads++;data={minPasswordLength:12};}
  else if(p==='/users'){userReads++;if(fail)return {ok:false,status:503,json:async()=>({error:'Synthetic failure'})};data=users;}
  else if(p==='/users/u2/permissions'&&options.method==='PATCH')writes++;
  return {ok:true,status:200,json:async()=>structuredClone(data)};
 };
 const $=s=>document.querySelector(s),wait=()=>new Promise(r=>setTimeout(r,50));
 try{
  await import(`./app.js?application-users-${locale}`);await wait();
  $('#administration').click();await wait();
  assert.equal($('#applicationAdminDialog').open,true);assert.equal(userReads,0);
  assert.equal($('#applicationAdminDialog #users'),null);
  assert.equal($('#applicationAdminSections').children.length,4);
  $('#minPasswordLength').value='18';
  $('#openApplicationUsers').click();await wait();
  assert.equal($('#applicationUsersDialog').open,true);assert.equal(userReads,1);
  assert.equal($('#applicationUsersTitle').textContent,locale==='en'?'Users':'Пользователи');
  const query=$('[data-directory="users"] input');query.value='Synthetic';query.dispatchEvent(new dom.window.Event('input'));assert.equal($('#users').children.length,1);
  $('[data-edit-permissions="u2"]').click();
  assert.deepEqual([...$('#permissionList').querySelectorAll('input')].map(input=>input.value),['manage_application']);
  $('#savePermissions').click();await wait();
  assert.equal(writes,1);assert.equal(userReads,2);assert.equal(settingsReads,1);
  assert.equal($('[data-directory="users"] input').value,'Synthetic');assert.equal($('#minPasswordLength').value,'18');
  assert.ok($('[data-user-lifecycle="u2"][data-action="delete"]'));
  $('#closeApplicationUsers').click();assert.equal($('#applicationUsersDialog').open,false);assert.equal($('#applicationAdminDialog').open,true);
  fail=true;$('#openApplicationUsers').click();await wait();assert.match($('#applicationUsersError').textContent,/Synthetic failure/);assert.equal($('#retryApplicationUsers').hidden,false);
  fail=false;$('#retryApplicationUsers').click();await wait();assert.equal($('#applicationUsersError').textContent,'');
 }finally{dom.window.close();}
});
