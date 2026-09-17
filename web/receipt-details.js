import { syncMarkup } from './dom-sync.js';
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function receiptButton(id,status,summary,group,locale='ru') {
 const en=locale==='en',labels=en?{sent:'Sent',delivered:'Delivered to all',read:'Read by all'}:{sent:'Отправлено',delivered:'Доставлено всем',read:'Прочитано всеми'};
 const state=['sent','delivered','read'].includes(status)?status:'sent';
 const count=group&&summary?`<span class="receiptCount">${en?'Read':'Прочитали'} ${summary.read} ${en?'of':'из'} ${summary.total}</span>`:'';
 return `<button type="button" class="receiptInfo" data-no-i18n data-receipt-info="${safe(id)}" aria-label="${en?'Message information':'Информация о сообщении'}" title="${labels[state]}"><span class="messageStatus ${state}">${state==='sent'?'✓':'✓✓'}</span>${count}</button>`;
}

export function createReceiptDetails({request,locale=()=> 'ru'}) {
 let dialog=null, messageID=null,sequence=0;
 const t=(ru,en)=>locale()==='en'?en:ru;
 function close(){if(dialog){dialog.close();}}
 async function refresh(){
  if(!dialog?.open)return;
  const current=dialog,id=messageID,version=++sequence;
  const button=current.querySelector('[data-refresh]');button.disabled=true;
  try {
   const data=await request(`/messages/${encodeURIComponent(id)}/receipts`);
   if(dialog!==current||sequence!==version||!current.open)return;
   const entries=data.recipients||[];
   const time=value=>new Date(value).toLocaleString(locale()==='en'?'en-GB':'ru-RU');
   const groups=[
    [t('Прочитали','Read'),entries.filter(r=>r.readAt)],
    [t('Доставлено, не прочитано','Delivered, not read'),entries.filter(r=>!r.readAt&&r.deliveredAt)],
    [t('Не доставлено','Not delivered'),entries.filter(r=>!r.deliveredAt&&!r.readAt)]
   ];
   syncMarkup(current.querySelector('[data-recipients]'),entries.length?groups.map(([label,people])=>`<section><h4>${label} (${people.length})</h4><ul>${people.map(r=>`<li data-id="${safe(r.userId)}"><strong>${safe(r.name)}</strong><small>${r.readAt?`${t('Прочитано','Read')}: ${safe(time(r.readAt))}`:t('Прочтение не подтверждено','Reading not confirmed')}${r.deliveredAt?`<br>${t('Доставлено','Delivered')}: ${safe(time(r.deliveredAt))}`:''}</small></li>`).join('')}</ul></section>`).join(''):`<p>${t('Других участников нет.','There are no other participants.')}</p>`);
   current.querySelector('[data-error]').textContent='';
  } catch(e){if(dialog===current&&sequence===version&&current.open){current.querySelector('[data-recipients]').replaceChildren();current.querySelector('[data-error]').textContent=e.message;}}
  finally{if(dialog===current&&sequence===version)button.disabled=false;}
 }
 function open(id,opener){
  close();messageID=id;
  const current=document.createElement('dialog');dialog=current;current.className='receiptDialog';current.setAttribute('data-no-i18n','');current.setAttribute('aria-labelledby','receiptInfoTitle');
  current.innerHTML=`<div class="needDialogHead"><h3 id="receiptInfoTitle">${t('Информация о сообщении','Message information')}</h3><button type="button" class="secondary" data-close aria-label="${t('Закрыть','Close')}">×</button></div><p class="muted">${t('Показан текущий состав чата, без автора. При изменении участников сведения о старых сообщениях тоже изменяются.','Current chat members, excluding the author. Membership changes also affect old messages.')}</p><p class="muted">${t('Время подтверждения сервером, в часовом поясе этого устройства. Оно может отличаться от времени просмотра.','Server acknowledgement time, in this device’s time zone. It may differ from viewing time.')}</p><button type="button" class="secondary" data-refresh>${t('Обновить','Refresh')}</button><p class="error" data-error role="alert"></p><div data-recipients aria-live="polite">${t('Загрузка…','Loading…')}</div>`;
  current.querySelector('[data-close]').onclick=close;
  current.querySelector('[data-refresh]').onclick=refresh;
  current.onclose=()=>{current.remove();if(dialog===current){dialog=null;messageID=null;sequence++;}if(opener?.isConnected)opener.focus({preventScroll:true});};
  current.onclick=e=>{if(e.target===current){const r=current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)current.close();}};
  document.body.append(current);current.showModal();void refresh();
 }
 return {open,refresh,close};
}
