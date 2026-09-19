export function shouldSend(event,mode='ctrl_enter') {
 if(event.key!=='Enter'||event.isComposing||event.keyCode===229||event.repeat||event.shiftKey||event.altKey)return false;
 return mode==='enter'?!event.ctrlKey&&!event.metaKey:!!(event.ctrlKey||event.metaKey);
}
export function initSendSettings({button,preferences,request,onSaved}) {
 button.onclick=()=>{
  const t=(ru,en)=>preferences().locale==='en'?en:ru;
  const dialog=document.createElement('dialog');dialog.setAttribute('data-no-i18n','');
  dialog.innerHTML=`<section class="dialogSurface"><h2>${t('Сообщения','Messages')}</h2><form><label>${t('Отправлять сообщение','Send message')}<select name="shortcut"><option value="ctrl_enter">Ctrl+Enter / Cmd+Enter</option><option value="enter">Enter</option></select></label><p>${t('Shift+Enter — новая строка. Настройка сохраняется для аккаунта на всех устройствах; применяется на других устройствах после перезагрузки чата. Кнопка отправки работает всегда.','Shift+Enter inserts a new line. Saved for your account across devices; reload the chat on other devices to apply. The send button always works.')}</p><p role="alert" class="error"></p><button type="submit">${t('Сохранить','Save')}</button><button type="button" data-close>${t('Отмена','Cancel')}</button></form></section>`;
  dialog.querySelector('select').value=preferences().sendShortcut||'ctrl_enter';document.body.append(dialog);dialog.showModal();let busy=false;
  dialog.querySelector('[data-close]').onclick=()=>{if(!busy)dialog.close();};dialog.oncancel=e=>{if(busy)e.preventDefault();};dialog.onclose=()=>dialog.remove();
  dialog.querySelector('form').onsubmit=async e=>{
   e.preventDefault();if(busy)return;busy=true;const mode=dialog.querySelector('select').value;
   dialog.querySelectorAll('button,select').forEach(el=>el.disabled=true);
   try{const latest=await request('/user/preferences');const saved=await request('/user/preferences',{method:'PUT',body:JSON.stringify({...latest,sendShortcut:mode})});onSaved(saved);dialog.close();}
   catch(error){dialog.querySelector('[role=alert]').textContent=error.message;}
   finally{busy=false;dialog.querySelectorAll('button,select').forEach(el=>el.disabled=false);}
  };
 };
}
