import {safe} from './api.js';

export function initApplicationFamilies({request,locale,confirmAction}) {
 return async function openFamilies(){
  const t=(ru,en)=>locale()==='en'?en:ru;
  const roles={owner:t('Владелец','Owner'),admin:t('Администратор семьи','Family administrator'),member:t('Участник','Member')};
  const categories={child:t('Ребёнок','Child'),parent:t('Родитель','Parent'),grandparent:t('Бабушка / дедушка','Grandparent'),guardian:t('Опекун','Guardian'),relative:t('Родственник','Relative')};
  function dialog(title,body){
   const d=document.createElement('dialog');d.className='panelDialog globalFamilies';d.setAttribute('data-no-i18n','');
   d.innerHTML=`<section class="panelSurface"><header class="panelHeader"><h2>${safe(title)}</h2><button type="button" class="secondary" data-close>${t('Закрыть','Close')}</button></header><div class="panelBody">${body}<p data-error class="error" role="alert"></p></div></section>`;
   document.body.append(d);d.showModal();d.querySelector('[data-close]').onclick=()=>d.close();d.onclose=()=>d.remove();return d;
  }
  function paged(d,endpoint,render){
   let offset=0,serial=0;
   const search=d.querySelector('[data-search]'),list=d.querySelector('[data-list]'),error=d.querySelector('[data-error]');
   async function load(){
    const ticket=++serial;error.textContent='';
    try{
     const data=await request(`${endpoint}?q=${encodeURIComponent(search.value.trim())}&offset=${offset}`);
     if(ticket!==serial||!d.isConnected)return;
     if(offset && !data.items.length){offset=Math.max(0,offset-25);return load();}
     list.innerHTML=render(data.items)||`<li>${t('Ничего не найдено','No results')}</li>`;
     d.querySelector('[data-count]').textContent=`${t('Всего','Total')}: ${data.total}`;
     d.querySelector('[data-prev]').disabled=offset===0;d.querySelector('[data-next]').disabled=offset+25>=data.total;
    }catch(e){if(ticket===serial&&d.isConnected)error.textContent=e.message;}
   }
   d.querySelector('[data-search-form]').onsubmit=e=>{e.preventDefault();offset=0;load();};
   d.querySelector('[data-prev]').onclick=()=>{offset=Math.max(0,offset-25);load();};
   d.querySelector('[data-next]').onclick=()=>{offset+=25;load();};
   return load;
  }
  const searchMarkup=()=>`<form data-search-form class="globalFamilySearch"><label>${t('Поиск по названию или имени','Search by title or name')}<input data-search type="search" maxlength="120"></label><button>${t('Найти','Search')}</button></form><p data-count></p><ul data-list class="familyMemberList"></ul><p class="actions"><button type="button" data-prev class="secondary" disabled>${t('Назад','Previous')}</button><button type="button" data-next class="secondary" disabled>${t('Далее','Next')}</button></p>`;
  const root=dialog(t('Все семьи','All families'),`<p class="muted">${t('Управление не открывает доступ к переписке и вложениям. Число участников включает деактивированные аккаунты.','Management does not grant access to messages or attachments. Member counts include deactivated accounts.')}</p>${searchMarkup()}`);
  let familyItems=[];
  const loadFamilies=paged(root,'/application/families',items=>{familyItems=items;return items.map(f=>`<li class="familyMemberSummary"><div><strong>${safe(f.title)}</strong><small>${t('Участников','Members')}: ${f.members}${f.archived?' · '+t('Архив','Archived'):''}</small><span>${t('Владельцы','Owners')}: ${safe(f.owners.join(', ')||'—')}</span></div><button type="button" class="secondary" data-family="${safe(f.id)}">${t('Управлять','Manage')}</button></li>`).join('');});
  root.querySelector('[data-list]').onclick=e=>{const b=e.target.closest('[data-family]');if(b){const f=familyItems.find(f=>f.id===b.dataset.family);if(f)openFamily(f);}};
  async function openFamily(f){
   const endpoint=`/application/families/${encodeURIComponent(f.id)}`;
   const d=dialog(f.title,`<form data-title-form><label>${t('Название семьи','Family name')}<input name="title" maxlength="120" required value="${safe(f.title)}" ${f.archived?'disabled':''}></label><button ${f.archived?'disabled':''}>${t('Сохранить название','Save name')}</button></form><p><button type="button" data-add class="secondary" ${f.archived?'disabled':''}>${t('Добавить участника','Add member')}</button></p>${f.archived?`<p>${t('Архивная семья доступна только для просмотра.','Archived families are read-only.')}</p>`:''}${searchMarkup()}`);
   let members=[],busy=false;
   const loadMembers=paged(d,endpoint+'/members',items=>{members=items;return items.map(u=>`<li class="familyMemberSummary"><div><strong>${safe(u.name)}</strong><small>${safe(roles[u.role])}${u.disabled?' · '+t('Деактивирован','Deactivated'):''}</small><span>${safe(u.relationship)}</span><small>${safe(u.categories.map(c=>categories[c]||c).join(', '))}</small></div><button type="button" class="secondary" data-user="${safe(u.id)}" ${f.archived?'disabled':''}>${t('Редактировать','Edit')}</button></li>`).join('');});
   d.querySelector('[data-title-form]').onsubmit=async e=>{
    e.preventDefault();if(busy)return;busy=true;const b=e.target.querySelector('button');b.disabled=true;
    try{const title=e.target.elements.title.value.trim();await request(endpoint,{method:'PATCH',body:JSON.stringify({title})});f.title=title;d.querySelector('h2').textContent=title;await loadFamilies();d.querySelector('[data-error]').textContent='';}
    catch(error){d.querySelector('[data-error]').textContent=error.message;}finally{busy=false;b.disabled=false;}
   };
   d.querySelector('[data-list]').onclick=e=>{const b=e.target.closest('[data-user]');if(b){const u=members.find(u=>u.id===b.dataset.user);if(u)edit(u,false);}};
   d.querySelector('[data-add]').onclick=()=>{
    let candidates=[];
    const c=dialog(t('Добавить зарегистрированного пользователя','Add registered user'),searchMarkup());
    const load=paged(c,endpoint+'/candidates',items=>{candidates=items;return items.map(u=>`<li class="familyMemberSummary"><strong>${safe(u.name)}</strong><button type="button" data-candidate="${safe(u.id)}">${t('Выбрать','Select')}</button></li>`).join('');});
    c.querySelector('[data-list]').onclick=e=>{const b=e.target.closest('[data-candidate]');if(b){const u=candidates.find(u=>u.id===b.dataset.candidate);if(u){c.close();edit(u,true);}}};load();
   };
   function edit(u,adding){
    const e=dialog(t('Участник семьи','Family member'),`<h3>${safe(u.name)}</h3><form data-editor><fieldset><label>${t('Роль доступа','Access role')}<select name="role">${Object.entries(roles).map(([key,label])=>`<option value="${key}" ${key===u.role?'selected':''}>${safe(label)}</option>`).join('')}</select></label><label>${t('Отображаемый статус','Display status')}<input name="relationship" maxlength="80" value="${safe(u.relationship)}"></label><fieldset class="familyCategories"><legend>${t('Категории','Categories')}</legend>${Object.entries(categories).map(([key,label])=>`<label><input type="checkbox" name="category" value="${key}" ${u.categories.includes(key)?'checked':''}>${safe(label)}</label>`).join('')}</fieldset><p class="actions"><button>${adding?t('Добавить','Add'):t('Сохранить','Save')}</button>${adding?'':`<button type="button" class="secondary" data-remove>${t('Исключить из семьи','Remove from family')}</button>`}</p></fieldset></form>`);
    let saving=false;
    e.oncancel=event=>{if(saving)event.preventDefault();};e.querySelector('[data-close]').onclick=()=>{if(!saving)e.close();};
    async function change(remove){
     if(saving)return;saving=true;const form=e.querySelector('form');const fieldset=form.querySelector('fieldset');fieldset.disabled=true;e.querySelector('[data-error]').textContent='';
     const body={role:form.elements.role.value,relationship:form.elements.relationship.value,categories:[...form.querySelectorAll('[name="category"]:checked')].map(i=>i.value)};
     try{
      if(remove||adding||body.role!==u.role){
       const message=remove?t('Участник потеряет доступ к чатам и функциям этой семьи. История и личные диалоги сохранятся.','The member loses access to this family’s chats and features. History and direct messages remain.'):adding?t('Пользователь получит доступ к семейному чату и его истории.','The user will gain access to the family chat and its history.'):t('Изменить роль участника? Последнего активного владельца понизить нельзя.','Change this member’s role? The last active owner cannot be demoted.');
       if(!await confirmAction({title:u.name,message,confirmLabel:remove?t('Исключить','Remove'):t('Подтвердить','Confirm'),destructive:remove}))return;
      }
      await request(endpoint+'/members/'+encodeURIComponent(u.id),{method:remove?'DELETE':adding?'PUT':'PATCH',...(remove?{}:{body:JSON.stringify(body)})});
      e.close();await loadMembers();await loadFamilies();
     }catch(error){e.querySelector('[data-error]').textContent=error.message;}finally{saving=false;fieldset.disabled=false;}
    }
    e.querySelector('form').onsubmit=event=>{event.preventDefault();change(false);};e.querySelector('[data-remove]')?.addEventListener('click',()=>change(true));
   }
   await loadMembers();
  }
  await loadFamilies();
 };
}
