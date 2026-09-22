import {createEmailRetry} from './email-retry.js';
export function initMail({request,locale,policyChanged}){
 const t=(ru,en)=>locale()==='en'?en:ru;
 const dialog=document.createElement('dialog');dialog.className='mailDialog';dialog.dataset.noI18n='';document.body.append(dialog);
 dialog.addEventListener('close',()=>dialog.querySelectorAll('input[type=password]').forEach(input=>input.value=''));
 const button=document.createElement('button');button.type='button';button.className='tertiary';button.textContent=t('Забыли пароль?','Forgot password?');button.dataset.noI18n='';document.querySelector('.loginAlternatives').append(button);
 function show(title,markup){dialog.innerHTML=`<form class="dialogSurface admin"><header><h2>${title}</h2><button type="button" data-close class="secondary">${t('Закрыть','Close')}</button></header>${markup}<p data-error role="status"></p></form>`;dialog.querySelector('[data-close]').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();return dialog.querySelector('form');}
 function busy(form,value){form.querySelectorAll('button,input,select').forEach(node=>node.disabled=value);}
 button.onclick=()=>{
  const form=show(t('Восстановление пароля','Password recovery'),`<label>${t('Эл. почта','Email')}<input name="email" type="email" autocomplete="email" required maxlength="254"></label><button>${t('Отправить ссылку','Send link')}</button>`);
  const retry=createEmailRetry(form,{locale});
  form.onsubmit=async event=>{event.preventDefault();if(!retry.begin())return;const email=form.elements.email.value;let accepted=false;busy(form,true);try{await request('/auth/password-reset',{method:'POST',body:JSON.stringify({email})});accepted=true;form.querySelector('[data-error]').textContent=t('Если активный аккаунт с таким адресом существует, письмо будет отправлено. Проверьте также спам. Повторный запрос — через минуту.','If an active account exists, a message will be sent. Check spam too. You can retry in one minute.');}catch(error){form.querySelector('[data-error]').textContent=error.message;}finally{busy(form,false);retry.finish(accepted)}};
 };
 const params=new URLSearchParams(location.hash.slice(1));const purpose=params.get('emailAction'),token=params.get('token');
 if(['register','reset'].includes(purpose)&&token){
  // Fragment tokens never go to access logs or Referer. Remove from address bar
  // immediately; consume only after the user's explicit form submission.
  history.replaceState(null,'',location.pathname+location.search);
  const form=show(t(purpose==='register'?'Подтвердить регистрацию':'Новый пароль',purpose==='register'?'Confirm registration':'New password'),`<label>${t('Новый пароль','New password')}<input name="password" type="password" autocomplete="new-password" required minlength="12"></label><label>${t('Повторите пароль','Repeat password')}<input name="repeat" type="password" autocomplete="new-password" required></label><button>${t('Подтвердить','Confirm')}</button>`);
  request('/password-policy').then(p=>form.elements.password.minLength=p.minPasswordLength).catch(()=>{});
  form.onsubmit=async event=>{event.preventDefault();const password=form.elements.password.value;if(password!==form.elements.repeat.value){form.querySelector('[data-error]').textContent=t('Пароли не совпадают','Passwords do not match');return}busy(form,true);try{await request('/auth/email-complete',{method:'POST',body:JSON.stringify({purpose,token,password})});dialog.close();location.replace('/?emailAction=done');}catch(error){form.querySelector('[data-error]').textContent=error.message;busy(form,false)}};
 }
 if(new URLSearchParams(location.search).get('emailAction')==='done')document.querySelector('#error').textContent=t('Готово. Войдите с новым паролем.','Done. Sign in with your new password.');
 async function refreshPolicy(){
  try{const policy=await request('/auth/email-policy');for(const selector of ['#registerPassword','#invitePassword','#invitePasswordRepeat']){const field=document.querySelector(selector);if(field){field.required=!policy.verifyRegistration;field.closest('label').hidden=!!policy.verifyRegistration;}}policyChanged?.(policy);}catch{/* Server remains authoritative; do not silently turn verification off. */}
 }
 void refreshPolicy();
 async function openAdmin(){
  const form=show(t('Почта и подтверждения','Email and verification'),`<p>${t('Настройки хранятся только на сервере. Для смены подключения сначала выключите отправку, сохраните параметры и отправьте тест.','Settings are stored only on the server. To change the connection, disable delivery, save the configuration and send a test.')}</p>
   <label>SMTP<input name="host" required maxlength="253" autocomplete="off"></label>
   <label>${t('Порт','Port')}<input name="port" type="number" min="1" max="65535" required value="587"></label>
   <label>TLS<select name="tls"><option value="starttls">STARTTLS</option><option value="tls">TLS</option></select></label>
   <label>${t('Логин','Username')}<input name="username" autocomplete="off"></label>
   <label>${t('Пароль (пусто — не менять)','Password (blank to keep)')}<input name="password" type="password" autocomplete="new-password"></label>
   <label class="mailToggle"><input name="clearPassword" type="checkbox"><span>${t('Очистить сохранённый пароль','Clear saved password')}</span></label>
   <label>${t('Адрес отправителя','Sender email')}<input name="from" type="email" required></label>
   <label class="mailToggle"><input name="enabled" type="checkbox"><span>${t('Включить письма и восстановление пароля','Enable email and password recovery')}</span></label>
   <label class="mailToggle"><input name="verifyRegistration" type="checkbox"><span>${t('Подтверждать почту при регистрации','Verify email during registration')}</span></label>
   <p data-status></p><div class="actions"><button>${t('Сохранить','Save')}</button><button type="button" data-test class="secondary">${t('Отправить тест мне','Send me a test')}</button></div>`);
  const fill=data=>{for(const name of ['host','port','tls','username','from'])form.elements[name].value=data[name]??'';for(const name of ['enabled','verifyRegistration'])form.elements[name].checked=!!data[name];form.elements.password.value='';form.elements.clearPassword.checked=false;form.querySelector('[data-status]').textContent=t('Проверка: ','Test: ')+(data.tested?t('SMTP принял тестовое письмо','SMTP accepted the test message'):t('ещё не выполнена','not completed'))+(data.passwordConfigured?t(' · пароль сохранён',' · password saved'):'')+(data.lastStatus==='failed'?t(' · последняя отправка не удалась',' · last delivery failed'):'');};
  // Compare values, not event history: browsers may dispatch a delayed change
  // after save/blur or an input event without changing a field. Never retain a
  // password in the baseline; a nonempty password is always an unsaved change.
  const snapshot=()=>JSON.stringify([
   ...['host','port','tls','username','from'].map(key=>form.elements[key].value),
   ...['enabled','verifyRegistration'].map(key=>form.elements[key].checked),
  ]);
  let saved='';
  const dirty=()=>snapshot()!==saved||!!form.elements.password.value||form.elements.clearPassword.checked;
  busy(form,true);try{fill(await request('/application/mail'));saved=snapshot();busy(form,false);}catch(error){form.querySelector('[data-error]').textContent=error.message;form.querySelector('[data-close]').disabled=false;return}
  form.onsubmit=async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));for(const key of ['enabled','verifyRegistration','clearPassword'])data[key]=form.elements[key].checked;data.port=Number(data.port);busy(form,true);try{fill(await request('/application/mail',{method:'PUT',body:JSON.stringify(data)}));saved=snapshot();form.querySelector('[data-error]').textContent=t('Сохранено','Saved');await refreshPolicy();}catch(error){form.querySelector('[data-error]').textContent=error.message;}finally{form.elements.password.value='';busy(form,false)}};
  form.querySelector('[data-test]').onclick=async()=>{if(dirty()){form.querySelector('[data-error]').textContent=t('Сначала сохраните изменённые параметры.','Save your changes first.');return}busy(form,true);try{fill(await request('/application/mail',{method:'POST'}));saved=snapshot();form.querySelector('[data-error]').textContent=t('Проверьте свой почтовый ящик. После получения письма можно включить отправку.','Check your inbox. Enable delivery after receiving the message.');}catch(error){form.querySelector('[data-error]').textContent=error.message;}finally{busy(form,false)}};
 }
 return {openAdmin};
}
