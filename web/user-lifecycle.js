import { tr } from './i18n.js';
export function initUserLifecycle({request,locale,onChanged,announce}) {
 const $=s=>document.querySelector(s),dialog=$('#userLifecycleDialog'),form=$('#userLifecycleForm');
 const email=$('#userLifecycleEmail'),error=$('#userLifecycleError'),submit=form.querySelector('[type="submit"]'),cancel=$('#cancelUserLifecycle');
 let selected=null,busy=false;
 cancel.onclick=()=>{if(!busy)dialog.close();};
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 form.onsubmit=async e=>{
  e.preventDefault();if(busy||!selected)return;
  if(email.value.trim()!==selected.user.Email){error.textContent=tr('Введите точный email выбранного аккаунта',locale());return;}
  busy=true;submit.disabled=cancel.disabled=email.disabled=true;error.textContent='';
  try {
   await request(`/users/${encodeURIComponent(selected.user.ID)}/lifecycle`,{method:'POST',body:JSON.stringify({action:selected.action,email:email.value.trim()})});
   dialog.close();selected=null;email.value='';
   announce(tr('Изменение аккаунта сохранено',locale()));
   try{await onChanged();}catch(_){announce(tr('Обновите список пользователей',locale()),'error');}
  }catch(e){error.textContent=e.message;}
  finally{busy=false;submit.disabled=cancel.disabled=email.disabled=false;}
 };
 return (user,action)=>{
  if(busy)return;selected={user,action};form.reset();error.textContent='';
  $('#userLifecycleTitle').textContent=tr({activate:'Активировать аккаунт',deactivate:'Деактивировать аккаунт',delete:'Удалить аккаунт'}[action],locale());
  $('#userLifecycleTarget').textContent=`${user.Name} — ${user.Email}`;
  $('#userLifecycleDescription').textContent=tr(action==='delete'?'Необратимое удаление разрешено только для аккаунта без истории и связанных данных.':action==='deactivate'?'Вход будет запрещён, сессии отозваны. История сохранится.':'Пользователь сможет войти заново. Старые сессии не восстанавливаются.',locale());
  submit.textContent=tr(action==='delete'?'Удалить аккаунт':'Подтвердить',locale());
  submit.classList.toggle('danger',action!=='activate');dialog.showModal();email.focus();
 };
}
