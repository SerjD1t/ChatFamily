export function initAutomations({profile,request,locale,button}) {
 const t=(ru,en)=>locale()==='en'?en:ru;
 let dialog=null;
 async function open() {
  if(dialog?.isConnected)return;
  const current=document.createElement('dialog');dialog=current;current.className='automationDialog';current.setAttribute('data-no-i18n','');
  current.innerHTML=`<section class="dialogSurface admin"><header class="needDialogHead"><h2>${t('Автоматизация','Automation')}</h2><button type="button" class="secondary" data-close aria-label="${t('Закрыть','Close')}">×</button></header>
  <h3>${t('Ежедневный отчёт','Daily report')}</h3>
  <p>${t('В диалог с собой («Вы»): текущие личные дела и покупки, а также семейные записи, где вы исполнитель. Выполненные и архивные не включаются.','In your self-chat (You): active personal tasks and purchases, plus family items assigned to you. Completed and archived items are excluded.')}</p>
  <form><fieldset disabled><label class="automationToggle"><input name="dailyReportEnabled" type="checkbox"> <span>${t('Отправлять ежедневный отчёт','Send daily report')}</span></label>
  <label>${t('Время отправки','Send at')}<input name="reportTime" type="time" required step="60"></label>
  <label>${t('Часовой пояс','Time zone')}<input name="timeZone" list="automationTimeZones" required maxlength="100" placeholder="Europe/Moscow"></label><datalist id="automationTimeZones"></datalist>
  <p class="muted">${t('Расписание работает на сервере, даже если приложение закрыто. Первый отчёт — в ближайшее будущее указанное время. Если текущих записей нет, придёт короткое сообщение об этом.','The server runs the schedule even when the app is closed. The first report arrives at the next future scheduled time. An empty list produces a short report too.')}</p>
  <button type="submit">${t('Сохранить','Save')}</button></fieldset></form>
  <p class="error" data-error role="alert"></p><p data-result role="status"></p><button type="button" class="secondary" data-retry hidden>${t('Повторить загрузку','Retry loading')}</button></section>`;
  const zones=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):['Europe/Moscow','UTC'];
  for(const value of new Set(['UTC','Europe/Moscow',...zones])){const option=document.createElement('option');option.value=value;current.querySelector('datalist').append(option);}
  const form=current.querySelector('form'),fields=form.elements,fieldset=current.querySelector('fieldset'),error=current.querySelector('[data-error]'),result=current.querySelector('[data-result]'),retry=current.querySelector('[data-retry]');
  let busy=false,ready=false;
  current.querySelector('[data-close]').onclick=()=>{if(!busy)current.close();};
  current.oncancel=e=>{if(busy)e.preventDefault();};
  current.onclose=()=>{current.remove();if(dialog===current)dialog=null;};
  document.body.append(current);current.showModal();
  function fill(data){fields.dailyReportEnabled.checked=!!data.dailyReportEnabled;fields.reportTime.value=data.reportTime;fields.timeZone.value=data.timeZone;}
  async function load(){if(busy)return;busy=true;retry.hidden=true;error.textContent='';try{const data=await request('/user/automations');if(!current.isConnected)return;fill(data);ready=true;}catch(e){error.textContent=e.message;retry.hidden=false;}finally{busy=false;fieldset.disabled=!ready;}}
  retry.onclick=load;
  form.onsubmit=async e=>{
   e.preventDefault();if(busy||!ready)return;
   const body={dailyReportEnabled:fields.dailyReportEnabled.checked,reportTime:fields.reportTime.value,timeZone:fields.timeZone.value.trim()};
   busy=true;fieldset.disabled=true;error.textContent='';result.textContent='';
   try{const data=await request('/user/automations',{method:'PUT',body:JSON.stringify(body)});if(current.isConnected){fill(data);result.textContent=t('Настройки сохранены','Settings saved');}}
   catch(e){error.textContent=e.message;}
   finally{busy=false;fieldset.disabled=false;}
  };
  await load();
 }
 button.onclick=()=>{profile.close();void open();};
 return open;
}
