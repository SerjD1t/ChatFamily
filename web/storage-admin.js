import {safe} from './api.js';

export function initStorageAdmin({request,locale,confirmAction}) {
 return async function openStorage() {
  const en=locale()==='en',t=(ru,english)=>en?english:ru;
  const dialog=document.createElement('dialog');dialog.className='panelDialog storageDialog';dialog.setAttribute('data-no-i18n','');
  const labels={cache:t('Очистить весь кэш миниатюр','Clear all thumbnails'),cacheOld:t('Очистить старый кэш','Clear old thumbnails'),orphans:t('В карантин: неиспользуемые загрузки','Quarantine unused uploads'),restore:t('Восстановить из карантина','Restore quarantined files'),purge:t('Удалить просроченный карантин','Purge expired quarantine')};
  const hints={cache:t('Миниатюры создадутся заново. Оригиналы сохранятся.','Thumbnails will regenerate. Originals are preserved.'),cacheOld:t('Возраст считается от создания миниатюры, не от последнего просмотра.','Age is measured from thumbnail creation, not last view.'),orphans:t('Только файлы без ссылок в БД, старше заданного срока. Перемещение не освобождает диск. Старые неотправленные черновики могут потребовать повторного прикрепления.','Only files without database references older than the configured age. Moving does not free disk space. Old unsent drafts may need reattachment.'),restore:t('Восстанавливаются только файлы, для которых нет оригинала с тем же ключом.','Only files without an existing original at the same key are restored.'),purge:t('Безвозвратное удаление. Срок считается от помещения в карантин. Сначала убедитесь в наличии резервной копии.','Permanent deletion. Age is measured from quarantine entry. Ensure you have a backup first.')};
  const size=value=>`${(Number(value||0)/1048576).toFixed(2)} MB`;
  dialog.innerHTML=`<section class="panelSurface admin"><header class="panelHeader"><h2>${t('Хранилище','Storage')}</h2><button type="button" class="secondary iconButton" data-close aria-label="${t('Закрыть','Close')}">×</button></header><div class="panelBody">
  <p>${t('Настройки и обслуживание файлов приложения. Содержимое чужих переписок здесь не показывается.','Application file settings and maintenance. Private conversation contents are not shown here.')}</p>
  <p data-error class="error" role="alert"></p><p data-result role="status"></p>
  <section class="settingsSection"><h3>${t('Использование','Usage')}</h3><div class="storageStats" data-stats></div><p class="muted" data-tools></p><button class="secondary" data-refresh>${t('Обновить статистику','Refresh statistics')}</button></section>
  <section class="settingsSection"><h3>${t('Настройки','Settings')}</h3><form data-settings><fieldset disabled>
  <div class="storageToggles">${[['images',t('Миниатюры изображений','Image thumbnails')],['videos',t('Кадры видео','Video thumbnails')],['pdfs',t('Первая страница PDF','PDF first page')]].map(([name,label])=>`<label><input type="checkbox" name="${name}">${label}</label>`).join('')}</div>
  <div class="storageSettingsGrid">${[['cacheDays',1,t('Старый кэш, дней','Old cache, days')],['orphanDays',7,t('Неиспользуемые загрузки, дней','Unused uploads, days')],['trashDays',7,t('Хранить в карантине, дней','Keep quarantined, days')]].map(([name,min,label])=>`<label>${label}<input type="number" name="${name}" min="${min}" max="3650" required></label>`).join('')}</div>
  <p class="muted">${t('Сроки используются при ручном анализе. Автоматическая очистка не включена.','Ages apply to manual analysis. Automatic cleanup is not enabled.')}</p>
  <button>${t('Сохранить настройки','Save settings')}</button></fieldset></form></section>
  <section class="settingsSection"><h3>${t('Обслуживание','Maintenance')}</h3><p>${t('Сначала анализ, затем подтверждение. Файлы сохранённых сообщений и аватары защищены независимо от возраста.','Analyze first, then confirm. Referenced message files and avatars are protected regardless of age.')}</p>
  <div class="storageActions">${Object.entries(labels).map(([action,label])=>`<div><button type="button" class="secondary" data-action="${action}" disabled>${label}</button><small data-count="${action}"></small><p class="muted">${hints[action]}</p></div>`).join('')}</div></section>
  <section><h3>${t('Последние операции','Recent operations')}</h3><ul class="needActivity" data-history></ul></section></div></section>`;
  document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  const field=name=>dialog.querySelector(`[name="${name}"]`),error=dialog.querySelector('[data-error]');let busy=false,ready=false;
  async function load(initial=false) {
   const data=await request('/application/storage');if(!dialog.isConnected)return;
   if(initial)for(const [key,value]of Object.entries(data.settings)){const input=field(key);if(input)input.type==='checkbox'?input.checked=value:input.value=value;}
   dialog.querySelector('[data-stats]').innerHTML=[['originals',t('Оригиналы','Originals')],['cache',t('Кэш миниатюр','Thumbnail cache')],['trash',t('Карантин','Quarantine')]].map(([key,label])=>`<div><strong>${label}</strong><span>${size(data[key].bytes)}</span><small>${data[key].count} ${t('файлов','files')}</small></div>`).join('');
   dialog.querySelector('[data-tools]').textContent=`${t('Лимит загрузки','Upload limit')}: ${size(data.maxUploadBytes)} (${t('задаётся на сервере','configured on server')}). ${Object.entries(data.tools).map(([key,ok])=>key+': '+(ok?'✓':'—')).join(' · ')}. ${t('Пропущено нестандартных объектов','Unrecognized objects skipped')}: ${data.ignored}`;
   for(const [action,total]of Object.entries(data.candidates))dialog.querySelector(`[data-count="${action}"]`).textContent=`${total.count} · ${size(total.bytes)}`;
   const statuses={started:t('Начато','Started'),done:t('Завершено','Completed'),partial:t('Частично выполнено','Partially completed')};
   dialog.querySelector('[data-history]').innerHTML=data.history.map(event=>`<li><small>${safe(new Date(event.at).toLocaleString(en?'en':'ru'))} · ${safe(statuses[event.status]||event.status)}</small><p>${safe(labels[event.action]||event.action)} · ${event.count} · ${size(event.bytes)}</p></li>`).join('')||`<li class="muted">${t('Операций пока нет','No operations yet')}</li>`;
   ready=true;
  }
  async function perform(fn){if(busy)return;busy=true;error.textContent='';dialog.querySelectorAll('button:not([data-close])').forEach(b=>b.disabled=true);dialog.querySelector('fieldset').disabled=true;
   try{await fn();}catch(e){error.textContent=e.message;}finally{busy=false;dialog.querySelectorAll('button:not([data-close])').forEach(b=>b.disabled=!ready);dialog.querySelector('[data-refresh]').disabled=false;dialog.querySelector('fieldset').disabled=!ready;}}
  dialog.querySelector('[data-refresh]').onclick=()=>perform(()=>load(!ready));
  dialog.querySelector('[data-settings]').onsubmit=e=>{e.preventDefault();const body={};for(const key of ['images','videos','pdfs'])body[key]=field(key).checked;for(const key of ['cacheDays','orphanDays','trashDays'])body[key]=Number(field(key).value);
   perform(async()=>{await request('/application/storage/settings',{method:'PUT',body:JSON.stringify(body)});dialog.querySelector('[data-result]').textContent=t('Настройки сохранены','Settings saved');await load();});};
  dialog.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>perform(async()=>{
   const action=button.dataset.action,plan=await request('/application/storage/plan',{method:'POST',body:JSON.stringify({action})});if(!dialog.isConnected)return;
   if(!plan.total.count){dialog.querySelector('[data-result]').textContent=t('Подходящих файлов нет','No eligible files');return;}
   if(!await confirmAction({title:labels[action],message:`${plan.total.count} ${t('файлов','files')} · ${size(plan.total.bytes)}. ${hints[action]}`,confirmLabel:t('Подтвердить','Confirm'),destructive:action!=='restore'}))return;
   const result=await request('/application/storage/execute',{method:'POST',body:JSON.stringify({token:plan.token,confirm:true})});
   dialog.querySelector('[data-result]').textContent=`${t('Обработано','Processed')}: ${result.count} · ${size(result.bytes)}`;await load();
  }));
  await perform(()=>load(true));
 };
}
