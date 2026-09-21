import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {filterNeeds,mountNeeds,openNeedsTarget} from './family-needs.js';
import {summarizeShopping} from './family-context.js';
const items=[
 {id:'1',title:'Хлеб',kind:'purchase',plannedDate:'2026-09-16T00:00:00Z',version:1},
 {id:'2',title:'Позвонить',kind:'task',description:'Врач',assigneeName:'Алёна',plannedDate:'2026-09-15T00:00:00Z',version:1},
 {id:'3',title:'Готово',kind:'task',completedAt:'2026-09-15T12:00:00Z',version:1},
 {id:'4',title:'Архив',kind:'purchase',archivedAt:'2026-09-15T12:00:00Z',version:1},
 {id:'5',title:'Без срока',kind:'task',version:1},
];
test('needs search, type, completed and archive filters remain independent',()=>{
 assert.deepEqual(filterNeeds(items,{query:'алена врач'}).map(n=>n.id),['2']);
 assert.deepEqual(filterNeeds(items,{kind:'purchase'}).map(n=>n.id),['1']);
 assert.deepEqual(filterNeeds(items,{status:'done'}).map(n=>n.id),['3']);
 assert.deepEqual(filterNeeds(items,{status:'archive'}).map(n=>n.id),['4']);
});
test('counters exclude completed, archived and undated from today/overdue',()=>{
 assert.deepEqual(summarizeShopping(items,new Date(2026,8,16,12)),{plannedToday:1,overdue:1,total:3});
});
const require=createRequire(import.meta.url);let JSDOM;try{({JSDOM}=require(process.env.TEST_JSDOM_PATH||'jsdom'));}catch{}

test('widget target opens only current family cards and explicit family creation',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;globalThis.window=dom.window;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 try{
  const host=document.querySelector('main');const item={id:'widget-item',familyId:'f1',kind:'task',title:'Synthetic task',version:1};
  mountNeeds({host,familyID:'f1',items:[item,{id:'private',ownerUserId:'self',title:'Private'}],request:async()=>({item,members:[],activity:[],canEdit:true}),refresh:async()=>{},announce:()=>{}});
  await openNeedsTarget(host,{itemId:'widget-item'});assert.ok(host.querySelector('.needDialog[open]'));
  await assert.rejects(openNeedsTarget(host,{itemId:'private'}));
  await assert.rejects(openNeedsTarget(host,{itemId:'missing'}));
  await openNeedsTarget(host,{createKind:'purchase'});
  assert.equal(host.querySelector('[name=createScope]').value,'family');
  assert.equal(host.querySelector('[name=kind]:checked').value,'purchase');
 }finally{dom.window.close();delete globalThis.document;delete globalThis.window;}
});

for(const locale of ['ru','en'])test(`quick date and assignee preserve card, draft and versions (${locale})`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;globalThis.window=dom.window;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const settle=()=>new Promise(r=>setTimeout(r,0));
 try{
  const host=document.querySelector('main'),calls=[];let fail=false,release;
  let saved={...items[0],familyId:'f1',plannedDate:null};
  const args={host,familyID:'f1',locale,currentUserID:'me',items:[saved],announce:()=>{},refresh:async()=>mountNeeds({...args,items:[saved]}),request:async(path,opts)=>{
   if(opts){const body=JSON.parse(opts.body);calls.push(body);await new Promise(r=>release=r);if(fail)throw Error('Conflict');saved={...saved,...body,version:saved.version+1,assigneeName:body.assigneeId==='me'?'Self':''};return {...saved};}
   return {item:{...saved},members:[{id:'me',name:'Self'},{id:'other',name:'Other'}],activity:[],canEdit:true};
  }};
  mountNeeds(args);host.querySelector('[data-open]').click();await settle();
  const card=host.querySelector('.needDialog'),comment=card.querySelector('[data-comment] textarea');comment.value='Keep draft';
  card.querySelector('[data-quick=date]').click();let popup=card.querySelector('.needQuickDialog');
  assert.equal(popup.querySelectorAll('[data-date]').length,4);
  const tomorrow=popup.querySelectorAll('[data-date]')[1];tomorrow.click();tomorrow.click();assert.equal(calls.length,1);assert.equal(calls[0].version,1);
  release();await settle();assert.equal(card.isConnected,true);assert.equal(comment.value,'Keep draft');assert.equal(card.querySelector('.needQuickDialog'),null);
  assert.equal(card.querySelector('[data-edit] [name=plannedDate]').value,calls[0].plannedDate);
  card.querySelector('[data-quick=assignee]').click();popup=card.querySelector('.needQuickDialog');
  assert.equal(popup.querySelector('[type=search]'),null);popup.querySelector('[data-assignee=me]').click();release();await settle();
  assert.equal(calls[1].version,2);assert.equal(card.querySelector('[data-quick=assignee]').textContent,'Self');
  card.querySelector('[data-quick=assignee]').click();popup=card.querySelector('.needQuickDialog');
  assert.equal(popup.querySelector('[data-assignee=me]').getAttribute('aria-pressed'),'true');
  popup.querySelector('[data-assignee=me]').click();assert.equal(calls.length,2);
  card.querySelector('[data-quick=assignee]').click();popup=card.querySelector('.needQuickDialog');fail=true;
  popup.querySelector('[data-assignee=""]').click();release();await settle();assert.match(popup.textContent,/Conflict/);assert.equal(comment.value,'Keep draft');
  assert.equal(card.querySelector('[data-quick=assignee]').textContent,'Self');
  fail=false;popup.querySelector('[data-assignee=""]').click();release();await settle();assert.equal(calls.at(-1).version,3);
  card.querySelector('[data-quick=date]').click();card.querySelector('[data-dismiss]').click();assert.equal(card.isConnected,true);
  assert.equal(host.querySelector('.needDialog'),card);assert.equal(comment.value,'Keep draft');
 }finally{dom.window.close();delete globalThis.document;delete globalThis.window;}
});

test('quick controls respect edit rights, archive and personal scope',{skip:!JSDOM},async()=>{
 for(const [canEdit,archived,personal] of [[false,false,false],[true,true,false],[true,false,true]]){
  const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  try{
   const item={...items[0],ownerUserId:personal?'me':undefined,archivedAt:archived?'2026-09-18':null};
   mountNeeds({host:document.querySelector('main'),familyID:'f1',items:[item],request:async()=>({item,members:[],activity:[],canEdit}),refresh:async()=>{},announce:()=>{}});
   document.querySelector('[name=status][value=archive]').checked=archived;
   if(archived)document.querySelector('[name=status][value=archive]').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
   document.querySelector('[data-open]').click();await new Promise(r=>setTimeout(r,0));
   assert.equal(!!document.querySelector('[data-quick=date]'),canEdit&&!archived);
   assert.equal(document.querySelector('[data-quick=assignee]'),null);
  }finally{dom.window.close();delete globalThis.document;}
 }
});

for(const personal of [true,false])test(`scope transfer confirmation and version, personal=${personal}`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;globalThis.window=dom.window;
 const originalFormData=globalThis.FormData;globalThis.FormData=dom.window.FormData;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 try{
  const host=document.querySelector('main'),calls=[];let accepted=false,warning='';window.confirm=text=>{warning=text;return accepted;};
  const item={...items[0],familyId:personal?'':'f1',ownerUserId:personal?'self':undefined};
  mountNeeds({host,familyID:'f1',items:[item],request:async(path,opts)=>{calls.push([path,opts]);return path==='/families'?[{id:'f2',title:'Other family'}]:{item,members:[],activity:[],canEdit:true,canMove:true};},refresh:async()=>{},announce:()=>{}});
  host.querySelector('[data-open]').click();await settle();host.querySelector('[data-start-edit]').click();
  const form=host.querySelector('[data-edit]');form.elements.targetFamilyId.value=personal?'f2':'';
  const submit=()=>form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  submit();await settle();assert.equal(calls.filter(c=>c[1]).length,0);assert.ok(warning);
  accepted=true;submit();await settle();
  const sent=calls.find(c=>c[1]);assert.equal(sent[0],personal?'/me/needs/1':'/families/f1/needs/1');
  const body=JSON.parse(sent[1].body);assert.equal(body.targetFamilyId,personal?'f2':'');assert.equal(body.version,1);
 }finally{dom.window.close();delete globalThis.document;delete globalThis.window;globalThis.FormData=originalFormData;}
});

test('unified list routes each scope, filters, defaults private and clears family draft on switch',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 try{
  const host=document.querySelector('main'),calls=[];
  const mixed=[{...items[0],id:'private',ownerUserId:'self'},{...items[1],id:'family',familyId:'f1'}];
  const args={host,familyID:'f1',items:mixed,request:async(path,options)=>{calls.push([path,options]);return {item:mixed.find(n=>path.endsWith(n.id)),members:[],activity:[],canEdit:true};},refresh:async()=>{},announce:()=>{}};
  mountNeeds(args);assert.equal(host.querySelectorAll('.needRow').length,2);
  assert.equal(host.querySelector('[name=needScope]'),null);
  const scope=host.querySelector('[name=filterScope]');scope.value='personal';scope.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(host.querySelectorAll('.needRow').length,1);assert.ok(host.querySelector('[data-id=private]'));
  host.querySelector('[data-clear]').click();
  for(const id of ['private','family']){host.querySelector(`[data-open=${id}]`).click();await settle();
   assert.equal(calls.at(-1)[0],id==='private'?'/me/needs/private':'/families/f1/needs/family');
   assert.equal(!!host.querySelector('[name=assigneeId]'),id==='family');host.querySelector('[data-close]').click();
   const toggle=host.querySelector(`[data-toggle=${id}]`);toggle.checked=true;toggle.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await settle();
   assert.equal(calls.at(-1)[0],id==='private'?'/me/needs/private':'/families/f1/needs/family');
  }
  const form=host.querySelector('#shoppingForm');assert.equal(form.elements.createScope.value,'personal');
  form.elements.title.value='Shared';form.elements.createScope.value='family';
  form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();assert.equal(calls.at(-1)[0],'/families/f1/needs');
  assert.equal(form.elements.createScope.value,'personal');
  form.elements.title.value='Private draft';mountNeeds({...args,familyID:'f2',items:[mixed[0]]});assert.equal(form.elements.title.value,'Private draft');
  form.elements.title.value='Family draft';form.elements.createScope.value='family';mountNeeds({...args,familyID:'',items:[mixed[0]]});
  assert.equal(form.elements.title.value,'');assert.equal(form.elements.createScope.value,'personal');assert.ok(form.querySelector('option[value=family]').disabled);
 }finally{dom.window.close();delete globalThis.document;}
});

for (const locale of ['ru','en']) test(`personal needs: scope, private API, no assignee (${locale})`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 try{
  const host=document.querySelector('main'),calls=[];let scope='';
  const args={host,familyID:'',hasFamily:true,locale,changeScope:v=>scope=v,items:[{...items[0],ownerUserId:'self'}],request:async(path,options)=>{calls.push([path,options]);return {item:items[0],members:[],activity:[],canEdit:true};},refresh:async()=>{},announce:()=>{}};
  mountNeeds(args);
  assert.equal(host.querySelector('[name=needScope]'),null);
  host.querySelector('[data-open]').click();await settle();
  assert.equal(calls[0][0],'/me/needs/1');
  assert.equal(host.querySelector('[name=assigneeId]'),null);
  host.querySelector('[data-close]').click();
  host.querySelector('[data-add]').click();const form=host.querySelector('#shoppingForm');form.elements.title.value='Private draft';
  mountNeeds({...args,items:[{...items[0],commentCount:1}]});assert.equal(form.elements.title.value,'Private draft');
  form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls[1][0],'/me/needs');assert.equal(calls[1][1].method,'POST');
  assert.equal(host.querySelector('[name=createScope]').value,'personal');
  mountNeeds({...args,familyID:'f1'});assert.equal(host.querySelector('[name=createScope]').value,'personal');
  assert.equal(host.querySelector('#shoppingForm').elements.title.value,'');
 }finally{dom.window.close();delete globalThis.document;}
});
test('list first, visible filter summary, creation retry and duplicate protection',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 try{
  const host=document.querySelector('main');let calls=0,release,fail=true;
  const args={host,familyID:'list-first',items,request:async()=>{calls++;await new Promise(resolve=>release=resolve);if(fail)throw new Error('Try again');return {};},refresh:async()=>{},announce:()=>{}};
  mountNeeds(args);
  const create=host.querySelector('.needCreateDialog'),filters=host.querySelector('.needsFilters'),search=host.querySelector('[data-search]');
  assert.equal(create.open,false);assert.equal(filters.hidden,true);assert.equal(host.querySelectorAll('.needRow').length,3);
  search.click();const query=host.querySelector('[name=query]');query.value='Хлеб';query.dispatchEvent(new dom.window.Event('input',{bubbles:true}));search.click();
  assert.equal(filters.hidden,true);assert.equal(search.getAttribute('aria-expanded'),'false');assert.equal(host.querySelector('.needActiveFilters').hidden,false);assert.match(host.querySelector('[data-filter-summary]').textContent,/Хлеб/);
  host.querySelector('[data-clear]').click();assert.equal(host.querySelectorAll('.needRow').length,3);
  host.querySelector('[name=status][value=done]').click();assert.ok(host.querySelector('[data-id="3"]'));
  host.querySelector('[data-add]').click();const form=create.querySelector('form');form.elements.title.value='Draft';
  host.querySelector('[data-create-close]').click();host.querySelector('[data-add]').click();assert.equal(form.elements.title.value,'Draft');
  const submit=()=>form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));submit();submit();assert.equal(calls,1);
  release();await settle();assert.equal(create.open,true);assert.equal(form.elements.title.value,'Draft');assert.match(create.textContent,/Try again/);
  fail=false;submit();release();await settle();assert.equal(create.open,false);assert.equal(form.elements.title.value,'');assert.equal(host.querySelector('[name=status]:checked').value,'active');
 }finally{dom.window.close();delete globalThis.document;}
});
test('background update retains quick-add draft, filters, focus and row nodes',{skip:!JSDOM},()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 try{
  const host=document.querySelector('main'),args={host,familyID:'test',items,request:async()=>{},refresh:async()=>{},announce:()=>{}};
  mountNeeds(args);
  const title=host.querySelector('[name=title]'),query=host.querySelector('[name=query]');
  title.value='Unsent draft';query.value='Хлеб';query.focus();query.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  const row=host.querySelector('[data-id="1"]');
  mountNeeds({...args,items:items.map(n=>n.id==='1'?{...n,commentCount:2}:n)});
  assert.equal(host.querySelector('[name=title]'),title);assert.equal(title.value,'Unsent draft');
  assert.equal(document.activeElement,query);assert.equal(query.value,'Хлеб');
  assert.equal(host.querySelector('[data-id="1"]'),row);assert.match(row.textContent,/2/);
 }finally{dom.window.close();delete globalThis.document;}
});
test('user-provided titles cannot inject HTML attributes',{skip:!JSDOM},()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 try{
  const host=document.querySelector('main');
  mountNeeds({host,familyID:'test',items:[{id:'safe',title:'"><img src=x onerror=alert(1)>',kind:'task'}],request:async()=>{},refresh:async()=>{},announce:()=>{}});
  assert.equal(host.querySelector('img'),null);assert.equal(host.querySelector('input[type=checkbox]').getAttribute('onerror'),null);
 }finally{dom.window.close();delete globalThis.document;}
});
test('type switch submits selected kind and filter uses checked radio',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 try{
  const host=document.querySelector('main');let sent;
  mountNeeds({host,familyID:'test',items,request:async(_,options)=>{sent=JSON.parse(options.body);},refresh:async()=>{},announce:()=>{}});
  host.querySelector('[name=kind][value=task]').click();
  host.querySelector('[name=title]').value='Test task';
  host.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(sent.kind,'task');
  host.querySelector('[name=filterKind][value=task]').click();
  assert.equal(host.querySelector('[data-id="1"]'),null);assert.ok(host.querySelector('[data-id="2"]'));
 }finally{dom.window.close();delete globalThis.document;}
});
test('detail sends versioned updates and comments do not erase an unsaved edit',{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;globalThis.FormData=dom.window.FormData;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const calls=[];let commented=false;
 const item={...items[0],description:'Initial',commentCount:0};
 const request=async(path,options)=>{
  calls.push({path,options});
  if(options){if(path.endsWith('/comments'))commented=true;return {};}
  return {item:{...item,commentCount:commented?1:0},canEdit:true,members:[],activity:commented?[{id:1,actor:'Test',action:'comment',body:'Hello',createdAt:'2026-09-16T12:00:00Z'}]:[]};
 };
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 try{
  const host=document.querySelector('main');mountNeeds({host,familyID:'f1',items:[item],request,refresh:async()=>{},announce:()=>{}});
  host.scrollTop=180;
  host.querySelector('[data-open]').click();await settle();
  assert.equal(host.querySelector('[data-edit]').hidden,true);
  assert.match(host.querySelector('[data-summary]').textContent,/Хлеб/);
  host.querySelector('[data-start-edit]').click();
  assert.equal(host.querySelector('[data-edit]').hidden,false);
  const title=host.querySelector('[data-edit] [name=title]');title.value='Unsaved edit';
  const comment=host.querySelector('[data-comment]');comment.elements.body.value='Hello';
  comment.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(host.querySelector('[data-edit] [name=title]'),title);assert.equal(title.value,'Unsaved edit');
  assert.match(host.querySelector('[data-comments]').textContent,/Hello/);
  const edit=host.querySelector('[data-edit]');edit.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
  const patch=calls.find(c=>c.options?.method==='PATCH');assert.equal(JSON.parse(patch.options.body).version,1);
  assert.equal(JSON.parse(patch.options.body).title,'Unsaved edit');assert.equal(host.querySelector('.needDialog'),null);
  assert.equal(host.scrollTop,180);assert.equal(document.activeElement,host.querySelector('[data-open]'));
 }finally{dom.window.close();delete globalThis.document;delete globalThis.FormData;}
});
