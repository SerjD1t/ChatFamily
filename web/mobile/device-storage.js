import {registerNativePlugin} from './runtime.js';
let initialized=false;
export function initDeviceStorage({locale,confirmAction,plugin=registerNativePlugin('IncomingShare')}) {
 if(initialized)return;initialized=true;
 const button=document.createElement('button');button.type='button';button.className='menuAction deviceStorageButton';button.setAttribute('data-no-i18n','');
 const t=(ru,en)=>locale()==='en'?en:ru;
 const label=()=>button.textContent=t('Память устройства','Device storage');label();
 document.querySelector('#myProfile').after(button);
 document.querySelector('#userMenuDialog').addEventListener('click',label);
 document.querySelector('#openUserMenu')?.addEventListener('click',label);
 button.onclick=()=>{document.querySelector('#userMenuDialog').close();void openDeviceStorage({plugin,locale,confirmAction});};
}
export async function openDeviceStorage({plugin,locale,confirmAction}) {
 const t=(ru,en)=>locale()==='en'?en:ru,mb=n=>`${(Number(n||0)/1048576).toFixed(1)} ${t('МиБ','MiB')}`;
 const dialog=document.createElement('dialog');dialog.className='mobileShareDialog';dialog.setAttribute('data-no-i18n','');
 dialog.innerHTML=`<section class="dialogSurface"><header class="shareHeader"><h2>${t('Память устройства','Device storage')}</h2><button class="secondary" data-close aria-label="${t('Закрыть','Close')}">×</button></header>
 <div class="storageStats"><div>${t('Кэш открытых вложений','Opened attachment cache')}<strong data-cache>—</strong></div><div>${t('Неотправленные вложения','Pending attachments')}<strong data-pending>—</strong></div><div>${t('Свободно на устройстве','Free on device')}<strong data-free>—</strong></div></div>
 <p class="muted">${t('Показан кэш файлов приложения, без системного кэша WebView. Очередь отправки хранится отдельно.','File cache only; excludes system WebView cache. Pending shares are stored separately.')}</p>
 <form><fieldset disabled><label>${t('Лимит кэша, МиБ (100–1000)','Cache limit, MiB (100–1000)')}<input name="limitMiB" type="number" min="100" max="1000" required></label><label>${t('Хранить без открытия, дней (1–30)','Keep unused, days (1–30)')}<input name="days" type="number" min="1" max="30" required></label><button>${t('Сохранить','Save')}</button></fieldset></form>
 <p class="muted">${t('Автоочистка работает при запуске, возврате в приложение и открытии файлов. Недавно открытые файлы защищены на 15 минут, поэтому временно могут превышать уменьшенный лимит.','Cleanup runs on launch, resume and file opening. Recently opened files are protected for 15 minutes and may temporarily exceed a reduced limit.')}</p>
 <p class="actions"><button class="secondary" data-refresh>${t('Обновить','Refresh')}</button><button class="secondary" data-clear disabled>${t('Очистить кэш','Clear cache')}</button></p>
 <p>${t('Неотправленные файлы можно удалить отдельно во «Входящих вложениях» с подтверждением. Сохранённые вами файлы в «Загрузках» не затрагиваются.','Remove pending files separately in Incoming attachments with confirmation. Files you saved in Downloads are not affected.')}</p><p class="error" data-error role="alert"></p><p data-result role="status"></p></section>`;
 document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();let busy=false,ready=false;
 function render(data,settings=false){for(const [selector,key]of [['cache','cacheBytes'],['pending','pendingBytes'],['free','freeBytes']])dialog.querySelector(`[data-${selector}]`).textContent=mb(data[key]);if(settings)for(const key of ['limitMiB','days'])dialog.querySelector(`[name=${key}]`).value=data[key];ready=true;}
 async function act(fn){if(busy)return;busy=true;dialog.querySelector('[data-error]').textContent='';dialog.querySelector('fieldset').disabled=true;dialog.querySelectorAll('[data-clear],[data-refresh]').forEach(b=>b.disabled=true);try{await fn();}catch(e){dialog.querySelector('[data-error]').textContent=e.message;}finally{busy=false;dialog.querySelector('fieldset').disabled=!ready;dialog.querySelector('[data-clear]').disabled=!ready;dialog.querySelector('[data-refresh]').disabled=false;}}
 dialog.querySelector('[data-refresh]').onclick=()=>act(async()=>render(await plugin.storageStatus(),!ready));
 dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const body={limitMiB:Number(dialog.querySelector('[name=limitMiB]').value),days:Number(dialog.querySelector('[name=days]').value)};void act(async()=>{render(await plugin.storageSettings(body));dialog.querySelector('[data-result]').textContent=t('Настройки сохранены','Settings saved');});};
 dialog.querySelector('[data-clear]').onclick=()=>act(async()=>{if(!await confirmAction({title:t('Очистить кэш?','Clear cache?'),message:t('Сообщения, очередь отправки и вход в аккаунт сохранятся. Недавно открытые файлы останутся до окончания 15 минут защиты.','Messages, pending shares and login are preserved. Recently opened files remain protected for 15 minutes.'),confirmLabel:t('Очистить','Clear')}))return;render(await plugin.clearStorageCache({confirm:true}));dialog.querySelector('[data-result]').textContent=t('Очистка завершена. Остаток — защищённые недавно открытые файлы.','Cleanup completed. Remaining files were opened recently.');});
 await act(async()=>render(await plugin.storageStatus(),true));
}
