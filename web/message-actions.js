import {safe} from './api.js';
import {iconMarkup as icon} from './icons.js';

export function messageActionsMarkup(message,locale='ru') {
 const t=(ru,en)=>locale==='en'?en:ru,id=safe(message.id);
 return `<span class="messageActions" data-no-i18n><button class="reaction reactionAdd" data-message="${id}" data-add-reaction="true" title="${t('Добавить реакцию','Add reaction')}" aria-label="${t('Добавить реакцию','Add reaction')}">${icon('reaction')}</button><button class="reaction reactionReply" data-reply-id="${id}" title="${t('Ответить','Reply')}" aria-label="${t('Ответить','Reply')}">${icon('reply')}</button><button class="reaction" data-message-menu="${id}" title="${t('Действия','Actions')}" aria-label="${t('Действия','Actions')}" aria-expanded="false">${icon('more')}</button></span>`;
}

export function initMessageActions({request,user,locale=()=> 'ru',onSent=()=>{},getMessage=()=>null,onReact=()=>{},onMoreReactions=()=>{},onChanged=()=>{},confirm=async()=>false}) {
 let menu=null,dialog=null;
 const t=(ru,en)=>locale()==='en'?en:ru;
 function closeMenu(){if(!menu)return;menu.opener.setAttribute('aria-expanded','false');menu.element.remove();menu=null;}
 function showMenu(opener,id,sheet=false){
  closeMenu();
  const article=opener.closest('[data-message-id]');if(article?.dataset.deleted==='true')return;
  const message=getMessage(id),own=message&&message.authorId===user()?.ID;
  const element=document.createElement(sheet?'dialog':'div');element.className='messageActionMenu'+(sheet?' messageActionSheet':'');element.setAttribute('data-no-i18n','');element.setAttribute('aria-label',t('Действия с сообщением','Message actions'));
  element.innerHTML=`<div class="quickReactions">${['👍','❤️','😂','😮','😢','🙏'].map(emoji=>`<button type="button" data-quick="${emoji}" aria-label="${emoji}">${emoji}</button>`).join('')}<button type="button" data-more-reactions aria-label="${t('Другие реакции','More reactions')}">${icon('reaction')}</button></div><button type="button" data-reply-id="${safe(id)}">↩ ${t('Ответить','Reply')}</button><button type="button" data-forward>↪ ${t('Переслать','Forward')}</button><button type="button" data-copy>${t('Скопировать текст','Copy text')}</button>${own?`<button type="button" data-edit>${t('Редактировать','Edit')}</button><button type="button" data-delete>${t('Удалить','Delete')}</button>`:''}<p class="error" role="alert"></p><button type="button" data-close>${t('Закрыть','Close')}</button>`;
  document.body.append(element);menu={opener,element};opener.setAttribute('aria-expanded','true');
  if(sheet){element.showModal();element.addEventListener('cancel',e=>{e.preventDefault();closeMenu();opener.focus({preventScroll:true});});element.onclick=e=>{if(e.target===element)closeMenu();};}
  else {const rect=opener.getBoundingClientRect();element.style.left=`${Math.max(8,Math.min(rect.right-element.offsetWidth,document.documentElement.clientWidth-element.offsetWidth-8))}px`;element.style.top=`${Math.max(8,Math.min(rect.bottom+4,document.documentElement.clientHeight-element.offsetHeight-8))}px`;}
  element.querySelector('[data-forward]').onclick=()=>{closeMenu();void openForward(id,opener);};
  element.querySelector('[data-reply-id]').onclick=()=>closeMenu();
  element.querySelector('[data-close]').onclick=()=>{closeMenu();opener.focus({preventScroll:true});};
  element.querySelector('[data-more-reactions]').onclick=()=>{closeMenu();onMoreReactions(id);};
  element.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>{closeMenu();onReact(id,b.dataset.quick);});
  element.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(message?.body??article?.querySelector('.messageBody')?.textContent??'');closeMenu();}catch{element.querySelector('.error').textContent=t('Копирование недоступно. Проверьте разрешения браузера.','Copy unavailable. Check browser permissions.');}};
  element.querySelector('[data-edit]')?.addEventListener('click',()=>{closeMenu();editMessage(message,opener);});
  element.querySelector('[data-delete]')?.addEventListener('click',async()=>{closeMenu();if(await confirm({title:t('Удалить сообщение?','Delete message?'),message:t('Действие нельзя отменить.','This cannot be undone.'),confirmLabel:t('Удалить','Delete'),destructive:true})){try{await request(`/messages/${encodeURIComponent(id)}`,{method:'DELETE'});onChanged(message.conversationId);}catch{editMessage(message,opener,t('Не удалось удалить сообщение.','Could not delete message.'));}}});
  element.querySelector('button').focus({preventScroll:true});
 }
 function editMessage(message,opener,errorText=''){
  const d=document.createElement('dialog');d.className='forwardDialog';d.setAttribute('data-no-i18n','');d.innerHTML=`<h2>${t('Редактировать сообщение','Edit message')}</h2><textarea aria-label="${t('Текст сообщения','Message text')}" maxlength="4000"></textarea><p class="error" role="alert"></p><button type="button" data-save>${t('Сохранить','Save')}</button><button type="button" data-close>${t('Закрыть','Close')}</button>`;document.body.append(d);d.querySelector('textarea').value=message.body;d.querySelector('.error').textContent=errorText;d.showModal();d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>{d.remove();opener.focus({preventScroll:true});});
  d.querySelector('[data-save]').onclick=async e=>{e.target.disabled=true;try{await request(`/messages/${encodeURIComponent(message.id)}`,{method:'PATCH',body:JSON.stringify({body:d.querySelector('textarea').value})});d.close();onChanged(message.conversationId);}catch(err){d.querySelector('.error').textContent=err.message;}finally{e.target.disabled=false;}};
 }
 let press=null,suppressUntil=0;
 const cancelPress=()=>{if(press)clearTimeout(press.timer);press=null;};
 document.addEventListener('pointerdown',e=>{
  if(press){cancelPress();return;}if(e.pointerType!=='touch'&&e.pointerType!=='pen')return;
  const article=e.target.closest('.message[data-message-id]');if(!article||article.dataset.deleted==='true'||e.target.closest('button,input,textarea,video')||(e.target.closest('a')&&!e.target.closest('.attachmentCard')))return;
  const opener=article.querySelector('[data-message-menu]')||article;
  press={x:e.clientX,y:e.clientY,id:e.pointerId,timer:setTimeout(()=>{press=null;suppressUntil=Date.now()+800;showMenu(opener,article.dataset.messageId,true);},500)};
 });
 document.addEventListener('pointermove',e=>{if(press&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>10)cancelPress();},{passive:true});
 for(const name of ['pointerup','pointercancel'])document.addEventListener(name,cancelPress);
 document.addEventListener('click',e=>{if(Date.now()<suppressUntil&&e.target.closest('.message')){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
 document.addEventListener('contextmenu',e=>{const article=e.target.closest('.message[data-message-id]');if(!article||article.dataset.deleted==='true'||e.target.closest('input,textarea,video')||(e.target.closest('a')&&!e.target.closest('.attachmentCard')))return;e.preventDefault();cancelPress();if(!menu)showMenu(article.querySelector('[data-message-menu]')||article,article.dataset.messageId,e.pointerType==='touch'||!!globalThis.matchMedia?.('(hover: none)').matches);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu){const opener=menu.opener;closeMenu();opener.focus();}});
 document.addEventListener('click',e=>{
  const opener=e.target.closest('[data-message-menu]');
  if(opener){const same=menu?.opener===opener;closeMenu();if(same)return;
   showMenu(opener,opener.dataset.messageMenu,!!globalThis.matchMedia?.('(hover: none)').matches);return;
  }
  if(!menu?.element.contains(e.target))closeMenu();
 });
 document.addEventListener('scroll',e=>{cancelPress();if(menu&&!menu.element.contains(e.target))closeMenu();},true);
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
