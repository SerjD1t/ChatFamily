import {safe} from './api.js';

export function initBackupAdmin({request,locale,confirmAction}) {
 return async function openBackups() {
  const en=locale()==='en',t=(ru,english)=>en?english:ru;
  const dialog=document.createElement('dialog');dialog.className='panelDialog storageDialog';dialog.setAttribute('data-no-i18n','');
  const fields=[['recentDays',t('Все копии, до дней','All snapshots, up to days')],['dailyDays',t('По одной в день, до дней','Daily, up to days')],['weeklyDays',t('По одной в неделю, до дней','Weekly, up to days')],['monthlyDays',t('По одной в месяц, до дней','Monthly, up to days')],['limitGiB',t('Лимит репозитория, ГиБ (не более 500)','Repository limit, GiB (up to 500)')]];
  dialog.innerHTML=`<section class="panelSurface admin"><header class="panelHeader"><h2>${t('Резервные копии','Backups')}</h2><button type="button" class="secondary iconButton" data-close aria-label="${t('Закрыть','Close')}">×</button></header><div class="panelBody">
   <p>${t('Зашифрованные копии БД и оригиналов вложений в папке приложения Яндекс Диска. На время локального снимка чат ненадолго останавливается; загрузка идёт при работающем чате.','Encrypted database and original attachments in the Yandex application folder. Chat pauses briefly for local capture, then resumes during upload.')}</p>
   <p data-error class="error" role="alert"></p><p data-result role="status"></p><div data-status></div>
   <div class="dialogActions"><button type="button" class="secondary" data-refresh>${t('Обновить','Refresh')}</button><button type="button" class="secondary" data-action="check" disabled>${t('Проверить подключение','Check connection')}</button><button type="button" data-action="run" disabled>${t('Создать копию','Back up now')}</button></div>
   <form data-settings><fieldset disabled><legend>${t('Расписание и хранение','Schedule and retention')}</legend>
   <label><input type="checkbox" name="enabled">${t('Автоматическое копирование','Automatic backups')}</label>
   <div class="storageSettingsGrid"><label>${t('Периодичность, часов','Interval, hours')}<select name="intervalHours">${[1,3,6,12,24].map(n=>`<option value="${n}">${n}</option>`).join('')}</select></label>
   <label>${t('Ежедневно в (пусто — по интервалу)','Daily at (empty — use interval)')}<input type="time" name="dailyTime"></label>
   <label>${t('Часовой пояс расписания и хранения','Schedule and retention timezone')}<input name="timezone" maxlength="80" required placeholder="Europe/Moscow"></label>
   ${fields.map(([name,label])=>`<label>${label}<input type="number" name="${name}" min="1" max="${name==='limitGiB'?500:3650}" required></label>`).join('')}</div>
   <p class="muted">${t('Сроки должны возрастать. Более старые копии: одна за календарный год. Последняя копия всегда сохраняется. Лимит не сокращает сроки хранения автоматически.','Age limits must increase. Older snapshots: one per calendar year. The latest snapshot is always retained. The quota never silently shortens retention.')}</p>
   <button>${t('Сохранить','Save')}</button></fieldset></form>
   <section><h3>${t('Точки восстановления','Restore points')}</h3><ul data-snapshots></ul><p class="muted">${t('Восстановление выполняется отдельно оператором. Проверка целостности не заменяет пробное восстановление.','Restore is an operator procedure. Integrity checks do not replace a restore drill.')}</p></section>
   <section><h3>${t('Последние операции','Recent operations')}</h3><ul data-history></ul></section>
  </div></section>`;
  document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  let busy=false,data=null;const field=name=>dialog.querySelector(`[name="${name}"]`);
  const date=value=>value?new Date(value).toLocaleString(en?'en':'ru'):t('Нет','None');
  const errors={credentials_incomplete:t('Не настроен токен или пароль шифрования','Token or encryption password is missing'),insufficient_staging_space:t('Недостаточно места для локального снимка','Not enough space for local capture'),insufficient_restore_space:t('Недостаточно места для проверки восстановления','Not enough space for restore drill'),capture_timeout:t('Снимок не уложился в лимит 180 секунд','Capture exceeded the 180-second limit'),application_resume_unhealthy:t('Не удалось подтвердить запуск чата: требуется оператор','Chat did not pass health check: operator attention required'),remote_or_backup_failed:t('Ошибка облака или проверки копии. Проверьте токен, место и службу','Cloud or backup verification failed. Check credentials, space and service'),command_failed:t('Ошибка резервирования: требуется проверка службы оператором','Backup command failed: operator investigation required')};
  async function load(initial=false){
   data=await request('/application/backups');if(!dialog.isConnected)return;
   if(initial)for(const [key,value] of Object.entries(data.settings)){const el=field(key);if(el)el.type==='checkbox'?el.checked=value:el.value=value;}
   const s=data.status;
   dialog.querySelector('[data-status]').textContent=[data.workerStale?t('Служба не отвечает','Worker not responding'):s.running?t('Выполняется','Running'):data.pending?t('В очереди','Queued'):s.ready?t('Готово','Ready'):t('Требуется настройка на сервере','Server setup required'),
    `${t('Успешная копия','Last success')}: ${date(s.lastSuccess)}`,`${t('Следующий запуск','Next run')}: ${date(s.nextRun)}`,`${t('Размер репозитория','Repository size')}: ${(Number(s.bytes||0)/1024**3).toFixed(2)} GiB`,
    `${t('Проверка восстановления БД','Database restore drill')}: ${date(s.lastRestoreCheck)}`,
    s.connectionCheckedAt?`${t('Подключение','Connection')}: ${s.connectionOK?'✓':'✕'} · ${date(s.connectionCheckedAt)}`:'',s.error?`${t('Ошибка службы','Worker error')}: ${errors[s.error]||s.error}`:'',s.alertError?t('Не удалось отправить внешний сигнал','External notification failed'):''].filter(Boolean).join(' · ');
   dialog.querySelector('[data-snapshots]').innerHTML=(s.snapshots||[]).map(item=>`<li>${safe(date(item.time))} · <code>${safe(item.id.slice(0,12))}</code></li>`).join('')||`<li>${t('Копий пока нет','No snapshots yet')}</li>`;
   const actions={run:t('Копирование','Backup'),check:t('Подключение','Connection'),init:t('Инициализация','Initialization'),verify:t('Полная проверка','Full check'),'restore-check':t('Пробное восстановление','Restore drill')};
   dialog.querySelector('[data-history]').innerHTML=(s.history||[]).slice(-20).reverse().map(item=>`<li>${safe(date(item.at))} · ${safe(actions[item.action]||item.action)} · ${item.ok?'✓':'✕'}</li>`).join('');
  }
  async function perform(fn){if(busy)return;busy=true;dialog.querySelector('[data-error]').textContent='';dialog.querySelector('fieldset').disabled=true;dialog.querySelectorAll('button:not([data-close])').forEach(b=>b.disabled=true);
   try{await fn();}catch(e){if(dialog.isConnected)dialog.querySelector('[data-error]').textContent=e.message;}finally{busy=false;if(dialog.isConnected){dialog.querySelector('fieldset').disabled=!data;dialog.querySelector('form button').disabled=!data;dialog.querySelector('[data-refresh]').disabled=false;dialog.querySelector('[data-action="check"]').disabled=!data||data.workerStale||data.pending||data.status.running;dialog.querySelector('[data-action="run"]').disabled=!data||!data.status.ready||data.workerStale||data.pending||data.status.running;}}}
  dialog.querySelector('[data-refresh]').onclick=()=>perform(()=>load(!data));
  dialog.querySelector('[data-settings]').onsubmit=e=>{e.preventDefault();perform(async()=>{const settings={enabled:field('enabled').checked,timezone:field('timezone').value.trim(),intervalHours:Number(field('intervalHours').value),dailyTime:field('dailyTime').value};for(const [name]of fields)settings[name]=Number(field(name).value);
   await request('/application/backups',{method:'PUT',body:JSON.stringify(settings)});dialog.querySelector('[data-result]').textContent=t('Настройки сохранены','Settings saved');await load();});};
  dialog.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>perform(async()=>{const action=button.dataset.action;
   if(action==='run'&&!await confirmAction({title:t('Создать резервную копию?','Create backup?'),message:t('Чат кратко остановится для согласованного снимка. Рабочие данные не удаляются.','Chat will pause briefly for a consistent capture. Live data will not be deleted.'),confirmLabel:t('Создать копию','Back up')}))return;
   await request('/application/backups',{method:'POST',body:JSON.stringify({action})});dialog.querySelector('[data-result]').textContent=t('Запрос принят. Запуск в течение минуты; обновите состояние.','Queued. Starts within a minute; refresh status.');await load();}));
  await perform(()=>load(true));
 };
}
