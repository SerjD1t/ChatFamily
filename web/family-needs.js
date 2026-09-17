import { syncMarkup } from './dom-sync.js';
import { todayISO, formatShoppingDate } from './format.js';

const mounted = new WeakMap();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function filterNeeds(items, {query='',kind='',status='active'}={}) {
 const terms=query.trim().toLocaleLowerCase().replaceAll('ё','е').split(/\s+/).filter(Boolean);
 return items.filter(n => (!kind||n.kind===kind) &&
  (status==='archive'?!!n.archivedAt:!n.archivedAt&&(status==='done'?!!n.completedAt:!n.completedAt)) &&
  terms.every(t=>`${n.title} ${n.description||''} ${n.assigneeName||''}`.toLocaleLowerCase().replaceAll('ё','е').includes(t)));
}

export function mountNeeds({host,familyID,items,request,refresh,announce,locale='ru',isCurrent=()=>true}) {
 const previous=mounted.get(host);
 if(previous?.familyID===familyID && previous.locale===locale && previous.root.isConnected) {previous.update(items);return;}
 const t=(ru,en)=>locale==='en'?en:ru;
 const kindPicker=(name,value,all=false)=>`<fieldset class="needKind"><legend>${t('Тип','Type')}</legend><div>${(all?[['', '≡',t('Все','All')]]:[]).concat([['purchase','🛒',t('Покупка','Purchase')],['task','✓',t('Дело','Task')]]).map(([key,icon,label])=>`<label title="${label}"><input type="radio" name="${name}" value="${key}" ${key===value?'checked':''}><span><i aria-hidden="true">${icon}</i> ${label}</span></label>`).join('')}</div></fieldset>`;
 const base=`/families/${encodeURIComponent(familyID)}/needs`;
 const root=document.createElement('section');root.className='needs';root.setAttribute('data-no-i18n','');
 root.innerHTML=`<div class="needsToolbar"><button type="button" class="secondary" data-search aria-expanded="false">${t('Поиск и фильтры','Search and filters')}</button><button type="button" data-add>＋ ${t('Добавить','Add')}</button></div>
 <fieldset class="needsStatuses"><legend class="visuallyHidden">${t('Список','List')}</legend>${[['active',t('Текущие','Active')],['done',t('Выполненные','Completed')],['archive',t('Архив','Archive')]].map(([value,label])=>`<label><input type="radio" name="status" value="${value}" ${value==='active'?'checked':''}><span>${label}</span></label>`).join('')}</fieldset>
 <div class="needsFilters" hidden><label>${t('Поиск','Search')}<input type="search" name="query" placeholder="${t('Название, описание, исполнитель','Title, description, assignee')}"></label>
 ${kindPicker('filterKind','',true)}</div>
 <div class="needActiveFilters" hidden><span data-filter-summary></span><button type="button" class="secondary" data-clear>${t('Сбросить','Reset')}</button></div>
 <p class="muted" data-count role="status"></p><ul class="needsList"></ul>
 <dialog class="needCreateDialog" aria-labelledby="needCreateTitle"><div class="needDialogHead"><h3 id="needCreateTitle">${t('Добавить дело или покупку','Add a task or purchase')}</h3><button type="button" class="secondary" data-create-close aria-label="${t('Закрыть','Close')}">×</button></div><form id="shoppingForm" class="needsAdd">
 <label>${t('Название','Title')}<input name="title" maxlength="160" required placeholder="${t('Что нужно сделать или купить?','What needs doing or buying?')}"></label>
 ${kindPicker('kind','purchase')}
 <label>${t('Срок (необязательно)','Due date (optional)')}<input name="plannedDate" type="date"></label><p class="error" data-create-error role="alert"></p><button type="submit">${t('Добавить','Add')}</button></form></dialog>`;
 host.replaceChildren(root);host.onclick=null;host.onchange=null;
 let source=items, busy=false, dialog=null, selected=null, detailRequest=0;
 const form=root.querySelector('form'),list=root.querySelector('ul'),filters=root.querySelector('.needsFilters');
 const createDialog=root.querySelector('.needCreateDialog'),addButton=root.querySelector('[data-add]'),searchButton=root.querySelector('[data-search]');
 addButton.onclick=()=>{createDialog.showModal();form.elements.title.focus();};
 root.querySelector('[data-create-close]').onclick=()=>{if(!busy)createDialog.close();};
 createDialog.oncancel=e=>{if(busy)e.preventDefault();};
 createDialog.onclose=()=>addButton.focus({preventScroll:true});
 createDialog.onclick=e=>{if(e.target===createDialog&&!busy){const r=createDialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)createDialog.close();}};
 searchButton.onclick=()=>{filters.hidden=!filters.hidden;searchButton.setAttribute('aria-expanded',String(!filters.hidden));if(!filters.hidden)field('query').focus();};
 root.querySelector('[data-clear]').onclick=()=>{field('query').value='';root.querySelector('[name=filterKind][value=""]').checked=true;render();};
 const field=name=>root.querySelector(`[name="${name}"]:checked`)||root.querySelector(`[name="${name}"]`);
 function render() {
  const query=field('query').value.trim(),kind=field('filterKind').value;
  root.querySelector('.needActiveFilters').hidden=!query&&!kind;
  root.querySelector('[data-filter-summary]').textContent=[query?`${t('Поиск','Search')}: ${query}`:'',kind?(kind==='task'?t('Дела','Tasks'):t('Покупки','Purchases')):''].filter(Boolean).join(' · ');
  const shown=filterNeeds(source,{query:field('query').value,kind:field('filterKind').value,status:field('status').value});
  const today=todayISO();
  root.querySelector('[data-count]').textContent=`${t('Записей','Items')}: ${shown.length}`;
  syncMarkup(list,shown.map(n=>{
   const date=n.plannedDate?.slice(0,10)||'';
   return `<li data-id="${esc(n.id)}" class="needRow ${n.completedAt?'completed':''}">
   <input type="checkbox" data-toggle="${esc(n.id)}" aria-label="${esc(t('Выполнено: ','Completed: ')+n.title)}" ${n.completedAt?'checked':''} ${n.archivedAt?'disabled':''}>
   <button type="button" class="needOpen" data-open="${esc(n.id)}"><span class="needTitle"><span aria-label="${n.kind==='task'?t('Дело','Task'):t('Покупка','Purchase')}">${n.kind==='task'?'☑':'🛒'}</span> ${esc(n.title)}</span>
   <span class="needMeta ${date&&date<today&&!n.completedAt?'overdue':''}">${esc(date?formatShoppingDate(date,locale):t('Без срока','No due date'))}${n.assigneeName?' · '+esc(n.assigneeName):''} · ${t('Комментарии','Comments')}: ${n.commentCount||0}</span></button></li>`;
  }).join('')||`<li class="muted">${t('Список пуст','No items')}</li>`);
 }
 filters.oninput=render;filters.onchange=render;
 root.querySelector('.needsStatuses').onchange=render;
 async function mutate(path,body,method='PATCH') {
  return request(path,{method,body:JSON.stringify(body)});
 }
 async function reload() {if(isCurrent()&&root.isConnected)await refresh();}
 form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;busy=true;form.querySelectorAll('input,button').forEach(el=>el.disabled=true);
  root.querySelector('[data-create-error]').textContent='';
  try {await mutate(base,{title:form.elements.title.value,kind:form.elements.kind.value,plannedDate:form.elements.plannedDate.value},'POST');form.reset();createDialog.close();field('query').value='';root.querySelector('[name=filterKind][value=""]').checked=true;root.querySelector('[name=status][value=active]').checked=true;render();await reload();announce(t('Добавлено в текущие','Added to active items'));}
  catch(e){root.querySelector('[data-create-error]').textContent=e.message;}
  finally{busy=false;form.querySelectorAll('input,button').forEach(el=>el.disabled=false);}
 };
 list.onchange=async event=>{
  const id=event.target.dataset.toggle;if(!id)return;
  const item=source.find(n=>n.id===id);event.target.disabled=true;
  try{await mutate(base+'/'+encodeURIComponent(id),{completed:event.target.checked,version:item.version});await reload();}
  catch(e){announce(e.message,'error');render();}
 };
 list.onclick=event=>{const id=event.target.closest('[data-open]')?.dataset.open;if(id)openDetail(id);};

 function historyText(a) {
  const names={created:t('Создано','Created'),edited:t('Изменено','Edited'),completed:t('Выполнено','Completed'),reopened:t('Возвращено в работу','Reopened'),archived:t('В архиве','Archived'),unarchived:t('Восстановлено из архива','Unarchived')};
  const changed=[];
  if(a.before&&a.after){
   const labels={title:t('Название','Title'),description:t('Описание','Description'),kind:t('Тип','Type'),plannedDate:t('Срок','Due date'),assigneeId:t('Исполнитель','Assignee')};
   const value=(n,key)=>key==='assigneeId'?n.assigneeName:key==='plannedDate'?n[key]?.slice(0,10):key==='kind'?(n[key]==='task'?t('Дело','Task'):t('Покупка','Purchase')):n[key];
   for(const key of Object.keys(labels)) if((a.before[key]||'')!==(a.after[key]||'')) changed.push(`${labels[key]}: ${value(a.before,key)||'—'} → ${value(a.after,key)||'—'}`);
  }
  return (names[a.action]||a.action)+(changed.length?' · '+changed.join('; '):'');
 }
 async function openDetail(id) {
  const savedScroll=host.scrollTop,opener=[...list.querySelectorAll('[data-open]')].find(el=>el.dataset.open===id);
  const sequence=++detailRequest;
  try {
   const data=await request(base+'/'+encodeURIComponent(id));if(sequence!==detailRequest||!root.isConnected||!isCurrent())return;
   dialog?.remove();selected=data.item;
   const n=data.item, editable=data.canEdit&&!n.archivedAt;
   dialog=document.createElement('dialog');dialog.className='needDialog';dialog.setAttribute('data-no-i18n','');root.append(dialog);
   const options=data.members.map(m=>`<option value="${esc(m.id)}" ${m.id===n.assigneeId?'selected':''}>${esc(m.name)}</option>`).join('');
   const missing=n.assigneeId&&!data.members.some(m=>m.id===n.assigneeId)?`<option value="${esc(n.assigneeId)}" selected disabled>${esc(n.assigneeName)} (${t('недоступен','unavailable')})</option>`:'';
   const activity=entries=>entries.map(a=>`<li data-id="${esc(a.id)}" class="${a.action==='comment'?'needComment':'needEvent'}"><small>${esc(a.actor)} · ${esc(new Date(a.createdAt).toLocaleString(locale))}</small><p>${esc(a.action==='comment'?a.body:historyText(a))}</p></li>`).join('')||`<li class="muted">${t('Пока нет записей','No entries yet')}</li>`;
   dialog.innerHTML=`<div class="needDialogHead"><h3>${t('Карточка','Details')}</h3><button type="button" class="secondary" data-close aria-label="${t('Закрыть','Close')}">×</button></div>
    <p data-stale hidden role="status">${t('Запись обновилась. Закройте и откройте карточку, чтобы увидеть изменения.','This item changed. Close and reopen to see updates.')}</p>
    <p class="error" data-error role="alert"></p>
    <section class="needSummary" data-summary><h2>${esc(n.title)}</h2>
    <div class="needSummaryMeta"><span>${n.kind==='task'?t('✓ Дело','✓ Task'):t('🛒 Покупка','🛒 Purchase')}</span><span>${esc(n.plannedDate?formatShoppingDate(n.plannedDate.slice(0,10),locale):t('Без срока','No due date'))}</span><span>${esc(n.assigneeName||t('Не назначен','Unassigned'))}</span>${n.archivedAt?`<span>${t('В архиве','Archived')}</span>`:''}</div>
    ${n.description?`<p class="needDescription">${esc(n.description)}</p>`:''}
    ${n.completedAt?`<small>${t('Выполнено','Completed')}: ${esc(new Date(n.completedAt).toLocaleString(locale))}</small>`:''}
    ${editable?`<button type="button" class="secondary" data-start-edit>${t('Редактировать','Edit')}</button>`:''}</section>
    <form data-edit hidden><fieldset ${editable?'':'disabled'}>
    <label>${t('Название','Title')}<input name="title" maxlength="160" value="${esc(n.title)}" required></label>
    ${kindPicker('kind',n.kind)}
    <label>${t('Срок (можно оставить пустым)','Due date (optional)')}<input name="plannedDate" type="date" value="${esc(n.plannedDate?.slice(0,10)||'')}"></label>
    <label>${t('Исполнитель','Assignee')}<select name="assigneeId"><option value="">${t('Не назначен','Unassigned')}</option>${missing}${options}</select></label>
    <label>${t('Описание','Description')}<textarea name="description" maxlength="4000" rows="3">${esc(n.description)}</textarea></label>
    </fieldset>${editable?`<button>${t('Сохранить','Save')}</button> <button type="button" class="secondary" data-cancel-edit>${t('Отмена','Cancel')}</button>`:''}</form>
    <h4>${t('История и комментарии','History and comments')}</h4><ul class="needActivity" data-comments>${activity(data.activity)}</ul>
    ${!n.archivedAt?`<form data-comment><label>${t('Новый комментарий','New comment')}<textarea name="body" maxlength="4000" rows="2" required></textarea></label><button>${t('Отправить','Send')}</button></form>`:''}
    ${data.canEdit?`<details class="needMore"><summary>${t('Другие действия','Other actions')}</summary><button type="button" class="secondary" data-archive>${n.archivedAt?t('Вернуть из архива','Restore from archive'):t('В архив','Archive')}</button></details>`:''}`;
   const current=dialog;
   const editForm=current.querySelector('[data-edit]');
   function editMode(enabled){editForm.hidden=!enabled;current.querySelector('[data-summary]').hidden=enabled;if(enabled)editForm.elements.title.focus();}
   current.querySelector('[data-start-edit]')?.addEventListener('click',()=>editMode(true));
   current.querySelector('[data-cancel-edit]')?.addEventListener('click',()=>{editForm.reset();editMode(false);current.querySelector('[data-start-edit]').focus();});
   current.querySelector('[data-close]').onclick=()=>current.close();
   current.onclose=()=>{current.remove();if(dialog===current){dialog=null;selected=null;}if(root.isConnected&&isCurrent()){opener?.focus({preventScroll:true});host.scrollTop=savedScroll;}};
   current.onclick=e=>{if(e.target===current){const rect=current.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)current.close();}};
   let saving=false;
   async function act(operation,keepOpen=false) {
    if(saving)return;saving=true;
    current.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await operation();if(current.isConnected&&!keepOpen)current.close();await reload();}
    catch(e){current.querySelector('[data-error]').textContent=e.message;}
    finally{saving=false;current.querySelectorAll('button').forEach(b=>b.disabled=false);}
   }
   current.querySelector('[data-edit]').onsubmit=e=>{
    e.preventDefault();const body=Object.fromEntries(new FormData(e.target));body.version=n.version;
    // A former member can remain recorded, but cannot be newly assigned.
    if(body.assigneeId===n.assigneeId)delete body.assigneeId;
    act(()=>mutate(base+'/'+encodeURIComponent(id),body));
   };
   current.querySelector('[data-archive]')?.addEventListener('click',()=>act(()=>mutate(base+'/'+encodeURIComponent(id),{archived:!n.archivedAt,version:n.version})));
   current.querySelector('[data-comment]')?.addEventListener('submit',e=>{
    e.preventDefault();const body=e.target.elements.body.value;
    const commentForm=e.target;
    act(async()=>{
     await mutate(base+'/'+encodeURIComponent(id)+'/comments',{body},'POST');
     commentForm.elements.body.value='';
     const latest=await request(base+'/'+encodeURIComponent(id));
     if(!current.isConnected)return;
     syncMarkup(current.querySelector('[data-comments]'),activity(latest.activity));
     if(selected?.id===id)selected.commentCount=latest.item.commentCount;
    },true);
   });
   current.showModal();
  }catch(e){announce(e.message,'error');}
 }
 function update(next){
  source=next;render();
  if(selected&&dialog?.isConnected){
   const latest=next.find(n=>n.id===selected.id);
   dialog.querySelector('[data-stale]').hidden=!!latest&&latest.version===selected.version&&latest.commentCount===selected.commentCount;
  }
 }
 mounted.set(host,{familyID,locale,root,update});render();
}
