import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {filterNeeds,mountNeeds} from './family-needs.js';
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

for (const locale of ['ru','en']) test(`personal needs: scope, private API, no assignee (${locale})`,{skip:!JSDOM},async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 try{
  const host=document.querySelector('main'),calls=[];let scope='';
  const args={host,familyID:'',hasFamily:true,locale,changeScope:v=>scope=v,items:[items[0]],request:async(path,options)=>{calls.push([path,options]);return {item:items[0],members:[],activity:[],canEdit:true};},refresh:async()=>{},announce:()=>{}};
  mountNeeds(args);
  assert.equal(host.querySelector('[name=needScope]:checked').value,'personal');
  host.querySelector('[data-open]').click();await settle();
  assert.equal(calls[0][0],'/me/needs/1');
  assert.equal(host.querySelector('[name=assigneeId]'),null);
  host.querySelector('[data-close]').click();
  host.querySelector('[data-add]').click();const form=host.querySelector('#shoppingForm');form.elements.title.value='Private draft';
  mountNeeds({...args,items:[{...items[0],commentCount:1}]});assert.equal(form.elements.title.value,'Private draft');
  form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls[1][0],'/me/needs');assert.equal(calls[1][1].method,'POST');
  host.querySelector('[name=needScope][value=family]').click();assert.equal(scope,'family');
  mountNeeds({...args,familyID:'f1'});assert.equal(host.querySelector('[name=needScope]:checked').value,'family');
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
