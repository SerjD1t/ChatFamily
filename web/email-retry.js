// UI guard only: the server still enforces per-address rate limits.
// No recipient, password or invitation token is persisted in browser storage.
export function createEmailRetry(form,{locale=()=> 'ru',now=()=>Date.now()}={}) {
 const button=form.querySelector('button[type="submit"],button:not([type])');
 const initial=button.textContent,view=form.ownerDocument.defaultView;
 let pending=false,until=0,retry=false,timer;
 const update=()=>{
  const seconds=Math.max(0,Math.ceil((until-now())/1000));
  button.disabled=pending||seconds>0;
  if(retry){button.dataset.noI18n='';button.textContent=(locale()==='en'?'Resend email':'Отправить письмо повторно')+(seconds?` (${seconds} ${locale()==='en'?'s':'с'})`:'');}
  else button.textContent=initial;
  if(!seconds&&timer){view.clearInterval(timer);timer=null;}
 };
 const resume=()=>{update();if(until>now()&&!timer)timer=view.setInterval(update,250);};
 form.closest('dialog')?.addEventListener('close',()=>{view.clearInterval(timer);timer=null;});
 form.addEventListener('focusin',resume);
 return {
  begin(){if(pending||now()<until){resume();return false;}pending=true;update();return true;},
  finish(emailRequested=false){pending=false;if(emailRequested){retry=true;until=now()+60000;}resume();},
 };
}
