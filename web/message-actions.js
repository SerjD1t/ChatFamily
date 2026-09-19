import {safe} from './api.js';
import {iconMarkup as icon} from './icons.js';

export function messageActionsMarkup(message,locale='ru') {
 const t=(ru,en)=>locale==='en'?en:ru,id=safe(message.id);
 return `<span class="messageActions" data-no-i18n><button class="reaction reactionAdd" data-message="${id}" data-add-reaction="true" title="${t('Добавить реакцию','Add reaction')}" aria-label="${t('Добавить реакцию','Add reaction')}">${icon('reaction')}</button><button class="reaction reactionReply" data-reply-id="${id}" title="${t('Ответить','Reply')}" aria-label="${t('Ответить','Reply')}">${icon('reply')}</button><button class="reaction" data-message-menu="${id}" title="${t('Действия','Actions')}" aria-label="${t('Действия','Actions')}" aria-expanded="false">${icon('more')}</button></span>`;
}

export function initMessageActions({request,user,locale=()=> 'ru',onSent=()=>{}}) {
 let menu=null,dialog=null;
 const t=(ru,en)=>locale()==='en'?en:ru;
 function closeMenu(){if(!menu)return;menu.opener.setAttribute('aria-expanded','false');menu.element.remove();menu=null;}
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu){const opener=menu.opener;closeMenu();opener.focus();}});
 document.addEventListener('click',e=>{
  const opener=e.target.closest('[data-message-menu]');
  if(opener){const same=menu?.opener===opener;closeMenu();if(same)return;
   const element=document.createElement('div');element.className='messageActionMenu';element.setAttribute('data-no-i18n','');
   element.innerHTML=`<button type="button" data-reply-id="${safe(opener.dataset.messageMenu)}">↩ ${t('Ответить','Reply')}</button><button type="button" data-forward>↪ ${t('Переслать','Forward')}</button>`;
   document.body.append(element);menu={opener,element};opener.setAttribute('aria-expanded','true');
   const rect=opener.getBoundingClientRect();element.style.left=`${Math.max(8,Math.min(rect.right-element.offsetWidth,document.documentElement.clientWidth-element.offsetWidth-8))}px`;element.style.top=`${Math.max(8,Math.min(rect.bottom+4,document.documentElement.clientHeight-element.offsetHeight-8))}px`;
   element.querySelector('[data-forward]').onclick=()=>{const id=opener.dataset.messageMenu;closeMenu();void openForward(id,opener);};
   element.querySelector('[data-reply-id]').addEventListener('click',()=>closeMenu());
   element.querySelector('button').focus();return;
  }
  if(!menu?.element.contains(e.target))closeMenu();
 });
 document.addEventListener('scroll',e=>{if(menu&&!menu.element.contains(e.target))closeMenu();},true);
 globalThis.addEventListener?.('resize',closeMenu);
 async function openForward(source,opener){
  if(dialog)return;
  const d=document.createElement('dialog');dialog=d;d.className='forwardDialog';d.setAttribute('data-no-i18n','');
  d.innerHTML=`<header><h2>${t('Переслать сообщение','Forward message')}</h2><button type="button" data-close>${t('Закрыть','Close')}</button></header><p class="muted">${t('Будут отправлены текст и вложения. Выберите получателя и подтвердите отправку.','Text and attachments will be sent. Choose a recipient and confirm.')}</p><input type="search" aria-label="${t('Найти получателя','Find recipient')}" placeholder="${t('Найти человека или чат','Find a person or chat')}"><div class="forwardRecipients"></div><p data-selected role="status"></p><p class="error" role="alert"></p><button type="button" data-send disabled>${t('Переслать','Forward')}</button>`;
  document.body.append(d);d.showModal();
  const error=d.querySelector('.error'),send=d.querySelector('[data-send]'),list=d.querySelector('.forwardRecipients'),search=d.querySelector('input');
  let busy=false,selected=null,recipients=[],attempt=null,locked=false;
  const close=()=>{if(!busy)d.close();};d.querySelector('[data-close]').onclick=close;d.onclick=e=>{if(e.target===d)close();};d.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  d.addEventListener('close',()=>{d.remove();dialog=null;if(opener.isConnected)opener.focus({preventScroll:true});},{once:true});
  const render=()=>{const term=search.value.trim().toLocaleLowerCase();list.innerHTML=recipients.filter(r=>r.label.toLocaleLowerCase().includes(term)).slice(0,60).map(r=>`<button type="button" data-key="${safe(r.key)}" aria-pressed="${selected?.key===r.key}" ${locked?'disabled':''}>${safe(r.label)}</button>`).join('')||`<p>${t('Не найдено','No matches')}</p>`;};
  search.oninput=render;list.onclick=e=>{const button=e.target.closest('[data-key]');if(!button||busy||locked)return;selected=recipients.find(r=>r.key===button.dataset.key);attempt=null;d.querySelector('[data-selected]').textContent=selected.label;send.disabled=false;render();};
  try{
   const account=user();const [chats,contacts,families]=await Promise.all([request('/conversations'),request('/contacts'),request('/families')]);if(!d.isConnected)return;
   recipients=[{key:`user:${account.ID}`,label:`${account.Name} (${t('Вы','You')})`}];
   for(const c of chats){if(c.kind==='direct'&&c.peerUserId===account.ID)continue;const f=families.find(f=>f.id===c.familyId);recipients.push({key:`chat:${c.id}`,label:c.title+(f?` — ${f.title}`:'')});}
   const peers=new Set(chats.map(c=>c.peerUserId));for(const c of contacts)if(c.ID!==account.ID&&!peers.has(c.ID))recipients.push({key:`user:${c.ID}`,label:c.Name});render();
  }catch(e){error.textContent=e.message;}
  send.onclick=async()=>{
   if(!selected||busy)return;busy=true;locked=true;send.disabled=true;search.disabled=true;render();error.textContent='';
   try{
    attempt??={id:crypto.randomUUID(),cid:null};
    if(!attempt.cid)attempt.cid=selected.key.startsWith('chat:')?selected.key.slice(5):(await request(`/users/${encodeURIComponent(selected.key.slice(5))}/direct-conversation`,{method:'POST'})).id;
    const result=await request(`/messages/${encodeURIComponent(source)}/forward`,{method:'POST',body:JSON.stringify({conversationId:attempt.cid,requestId:attempt.id})});
    busy=false;d.close();onSent(result.conversationId);
   }catch(e){error.textContent=e.message+' '+t('Повторите отправку: повтор не создаст копию.','Retry sending: a retry will not create a duplicate.');}
   finally{busy=false;send.disabled=false;}
  };
 }
}
