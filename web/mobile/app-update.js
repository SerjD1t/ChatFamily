import {registerNativePlugin} from './runtime.js';
let initialized=false;
export function initAppUpdate({locale,announce,plugin=registerNativePlugin('AppUpdate')}) {
 if(initialized)return;initialized=true;
 const button=document.createElement('button');button.type='button';button.className='menuAction appUpdateButton';button.setAttribute('data-no-i18n','');
 let version='',busy=false;
 const label=()=>button.textContent=locale()==='en'?`App version${version?' '+version:''} · Check updates`:`Версия приложения${version?' '+version:''} · Проверить обновления`;
 label();document.querySelector('#myProfile').after(button);
 document.querySelector('#openUserMenu')?.addEventListener('click',label);
 async function check(manual=false) {
  if(busy||(!manual&&document.visibilityState==='hidden'))return;
  busy=true;button.disabled=true;
  try{await plugin.check({manual,locale:locale()});}catch(_){if(manual)announce(locale()==='en'?'Could not check for updates':'Не удалось проверить обновления','error');}
  finally{busy=false;button.disabled=false;}
 }
 button.onclick=()=>{document.querySelector('#userMenuDialog').close();void check(true);};
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void check();});
 // Android owns the daily throttle across page reloads and accounts.
 void plugin.status().then(info=>{version=String(info.versionName||'');label();}).catch(()=>{});
 void check();
}
