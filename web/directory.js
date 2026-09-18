import { safe } from './api.js';
const directoryState=new Map();
export function filterDirectory(users,query='',status='',role='',admin=false){
 const terms=query.trim().toLocaleLowerCase().replaceAll('ё','е').split(/\s+/).filter(Boolean);
 return users.filter(u=>{
  const haystack=`${u.Name||''} ${admin?u.Email||'':''}`.toLocaleLowerCase().replaceAll('ё','е');
  return terms.every(t=>haystack.includes(t))&&(!status||(status==='disabled')===!!u.disabled)&&(!role||(role==='admin')===!!u.Permissions?.manage_application);
 });
}
export function personalChatOrder(users,chats,locale='ru'){
 const times=new Map(chats.map(c=>[c.peerUserId,Date.parse(c.lastMessageAt)||0]));
 return [...users].sort((a,b)=>(times.get(b.ID)||0)-(times.get(a.ID)||0)||(a.Name||'').localeCompare(b.Name||'',locale)||a.ID.localeCompare(b.ID));
}
export function mountDirectory({list,users,render,admin=false,locale=()=> 'ru',order=items=>items}){
 const id=list.id||'personalDirectory';list.id=id;
 list.parentElement.querySelector(`[data-directory="${id}"]`)?.remove();
 const tools=document.createElement('div');tools.className='directoryTools';tools.dataset.directory=id;
 const t=(ru,en)=>locale()==='en'?en:ru;
 tools.innerHTML=`<label>${t(admin?'Поиск по имени, фамилии или email':'Поиск по имени и фамилии','Search by name'+(admin?' or email':''))}<input type="search" autocomplete="off" maxlength="200"></label>${admin?`<label>${t('Статус','Status')}<select data-status><option value="">${t('Все','All')}</option><option value="active">${t('Активные','Active')}</option><option value="disabled">${t('Деактивированные','Deactivated')}</option></select></label><label>${t('Роль','Role')}<select data-role><option value="">${t('Все','All')}</option><option value="admin">${t('Администраторы','Administrators')}</option><option value="member">${t('Остальные','Others')}</option></select></label>`:''}<div class="directoryPaging"><span role="status"></span><button type="button" class="secondary" data-prev>${t('Назад','Previous')}</button><button type="button" class="secondary" data-next>${t('Далее','Next')}</button></div>`;
 tools.setAttribute('data-no-i18n','');list.before(tools);const saved=directoryState.get(id)||{};let page=saved.page||0;
 const query=tools.querySelector('input'),status=tools.querySelector('[data-status]'),role=tools.querySelector('[data-role]');
 query.value=saved.query||'';if(status)status.value=saved.status||'';if(role)role.value=saved.role||'';
 function update(){
  const filtered=order(filterDirectory(users,query.value,status?.value,role?.value,admin)),pages=Math.max(1,Math.ceil(filtered.length/25));page=Math.min(page,pages-1);
  directoryState.set(id,{page,query:query.value,status:status?.value,role:role?.value});
  const html=filtered.slice(page*25,page*25+25).map(render).join('')||`<${list.tagName==='UL'?'li':'p'} class="muted">${safe(t('Никого не найдено','No users found'))}</${list.tagName==='UL'?'li':'p'}>`;
  if(list.innerHTML!==html)list.innerHTML=html;
  tools.querySelector('[role="status"]').textContent=`${t('Найдено','Found')}: ${filtered.length} · ${page+1}/${pages}`;
  tools.querySelector('[data-prev]').disabled=page===0;tools.querySelector('[data-next]').disabled=page>=pages-1;
 }
 query.oninput=()=>{page=0;update();};if(status)status.onchange=()=>{page=0;update();};if(role)role.onchange=()=>{page=0;update();};
 tools.querySelector('[data-prev]').onclick=()=>{page--;update();};tools.querySelector('[data-next]').onclick=()=>{page++;update();};update();
 return ()=>{if(list.isConnected)update();};
}
