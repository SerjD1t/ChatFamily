const choices={skin:['family','classic'],mode:['system','light','dark','contrast'],density:['normal','compact','spacious','legacy-spacious'],text:['normal','small','large','legacy-large']};
export const appearanceDefaults={skin:'classic',mode:'system',density:'normal',text:'normal'};
export function normalizeAppearance(value={},legacyMode='system') {
 const result={...appearanceDefaults,mode:choices.mode.includes(legacyMode)?legacyMode:'system'};
 for(const key of Object.keys(choices))if(choices[key].includes(value?.[key]))result[key]=value[key];
 return result;
}
const keyFor=id=>`familychat.appearance.v2.${encodeURIComponent(id)}`;
export function loadAppearance(storage,id,legacyMode) {
 try{
  const current=storage.getItem(keyFor(id));
  if(current)return normalizeAppearance(JSON.parse(current),legacyMode);
  const old=JSON.parse(storage.getItem(`familychat.appearance.v1.${encodeURIComponent(id)}`)||'null');
  if(!old)return normalizeAppearance({},legacyMode);
  return normalizeAppearance({...old,density:({compact:'normal',normal:'spacious',spacious:'legacy-spacious'})[old.density],text:({small:'normal',normal:'large',large:'legacy-large'})[old.text]},legacyMode);
 }catch{return normalizeAppearance({},legacyMode);}
}
export function saveAppearance(storage,id,value){const normalized=normalizeAppearance(value);storage.setItem(keyFor(id),JSON.stringify(normalized));return normalized;}

// Change CSS only; anchor the reader without rebuilding messages or their controls.
export function applyAppearance(value,doc=document) {
 value=normalizeAppearance(value);
 const root=doc.documentElement,scroller=doc.querySelector('#messages');
 const bounds=scroller?.getBoundingClientRect();
 const anchor=bounds&&[...scroller.querySelectorAll('[data-message-id],.needRow')].find(el=>el.getBoundingClientRect().bottom>bounds.top);
 const offset=anchor?anchor.getBoundingClientRect().top-bounds.top:0;
 root.dataset.skin=value.skin;root.dataset.theme=value.mode;root.dataset.density=value.density;root.dataset.textSize=value.text;
 if(anchor?.isConnected)scroller.scrollTop+=anchor.getBoundingClientRect().top-scroller.getBoundingClientRect().top-offset;
}

export function createAppearanceSettings({form,dialog,userID,preferences,storage=localStorage}) {
 const t=(ru,en)=>preferences().locale==='en'?en:ru;
 let prepared=false;
 const saved=()=>loadAppearance(storage,userID(),preferences().colorScheme);
 const applySaved=()=>applyAppearance(saved());
 const fields=()=>({skin:form.querySelector('#interfaceSkin').value,mode:form.querySelector('#interfaceColorScheme').value,density:form.querySelector('#interfaceDensity').value,text:form.querySelector('#interfaceTextSize').value});
 function fill(value){for(const [id,key]of [['interfaceSkin','skin'],['interfaceColorScheme','mode'],['interfaceDensity','density'],['interfaceTextSize','text']])form.querySelector('#'+id).value=value[key];}
 function prepare(){
  const select=(id,label,options)=>`<label>${label}<select id="${id}">${options.map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label>`;
  form.setAttribute('data-no-i18n','');
  form.innerHTML=`<h3>${t('Интерфейс','Interface')}</h3><p class="muted">${t('Оформление сохраняется для этого аккаунта только на этом устройстве. Язык — для аккаунта на всех устройствах.','Appearance is saved for this account on this device only. Language is shared across devices.')}</p>
  ${select('interfaceLocale',t('Язык','Language'),[['ru','Русский'],['en','English']])}
  ${select('interfaceSkin',t('Оформление','Skin'),[['family',t('Семейное','Family')],['classic',t('Классическое','Classic')]])}
  ${select('interfaceColorScheme',t('Режим','Mode'),[['system',t('Как в системе','System')],['light',t('Светлый','Light')],['dark',t('Тёмный','Dark')],['contrast',t('Высококонтрастный','High contrast')]])}
  ${select('interfaceDensity',t('Плотность','Density'),[['compact',t('Компактная','Compact')],['normal',t('Обычная','Normal')],['spacious',t('Просторная','Spacious')],...(saved().density==='legacy-spacious'?[['legacy-spacious',t('Прежняя увеличенная','Previous extra spacing')]]:[])])}
  ${select('interfaceTextSize',t('Размер текста','Text size'),[['small',t('Меньше','Smaller')],['normal',t('Обычный','Normal')],['large',t('Крупнее','Larger')],...(saved().text==='legacy-large'?[['legacy-large',t('Прежний увеличенный','Previous extra large')]]:[])])}
  <div class="appearanceSample"><strong>${t('Предпросмотр','Preview')}</strong><p>${t('Так будет выглядеть текст сообщения.','This is how a message will look.')}</p><input aria-label="${t('Пример поля','Sample field')}" placeholder="${t('Пример поля','Sample field')}" readonly><button type="button">${t('Пример кнопки','Sample button')}</button></div>
  <p id="interfaceSettingsError" class="error" role="status"></p><div class="actions"><button type="button" class="secondary" data-appearance-reset>${t('Стандартные настройки','Defaults')}</button><button type="button" class="secondary" data-appearance-cancel>${t('Отмена','Cancel')}</button><button type="submit">${t('Сохранить','Save')}</button></div>`;
  fill(saved());form.querySelector('#interfaceLocale').value=preferences().locale||'ru';prepared=true;
  form.querySelector('[data-appearance-reset]').onclick=()=>{fill(appearanceDefaults);applyAppearance(appearanceDefaults);};
  form.querySelector('[data-appearance-cancel]').onclick=()=>{applySaved();form.hidden=true;};
 }
 form.addEventListener('change',event=>{if(prepared&&event.target.id!=='interfaceLocale')applyAppearance(fields());});
 dialog.addEventListener('close',applySaved);
 return {prepare,applySaved,save(){try{return saveAppearance(storage,userID(),fields());}catch{throw Error(t('Не удалось сохранить оформление на устройстве. Проверьте доступность хранилища браузера.','Could not save appearance on this device. Check browser storage availability.'));}}};
}
