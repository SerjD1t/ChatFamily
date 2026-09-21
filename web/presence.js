// User gestures, not fetch/WebSocket traffic, extend presence.
export function presenceLabel(value, locale='ru') {
 const en=locale==='en';
 if(!value)return en?'Status unavailable':'Статус недоступен';
 if(value.online)return en?'Online':'В сети';
 if(!value.lastActiveAt)return en?'Offline':'Не в сети';
 const date=new Date(value.lastActiveAt);
 if(!Number.isFinite(date.getTime()))return en?'Offline':'Не в сети';
 return (en?'Last seen: ':'Был(а): ')+date.toLocaleString(en?'en-GB':'ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
}

export function createPresence({request,user,locale=()=> 'ru',peer=()=>null,doc=document,win=window,now=()=>Date.now()}) {
 let stopped=false,sending=false,reading=false,lastSent=-Infinity,lastAction=0,dirty=false,timer=null,generation=0;
 let cache=new Map();
 const visible=()=>doc.visibilityState==='visible';
 function render(){
  for(const slot of doc.querySelectorAll('[data-presence-user]')){
   const entry=cache.get(slot.dataset.presenceUser);
   const value=entry&&now()-entry.at<45000?entry.value:null;
   const text=presenceLabel(value,locale());
   if(slot.textContent!==text)slot.textContent=text;
   slot.classList.toggle('presenceOnline',!!value?.online);
  }
  const current=doc.querySelector('#currentUserPresence');
  if(current){current.dataset.presenceUser=user()||'';current.setAttribute('data-no-i18n','');}
  const subtitle=doc.querySelector('#chatSubtitle'),uid=peer();
  if(subtitle&&uid){
   const entry=cache.get(uid);subtitle.textContent=presenceLabel(entry&&now()-entry.at<45000?entry.value:null,locale());
  }
 }
 async function refresh(){
  render();if(stopped||!user()||!visible()||reading)return;
  const uid=user(),version=generation;
  const ids=[...new Set([uid,peer(),...Array.from(doc.querySelectorAll('[data-presence-user]'),n=>n.dataset.presenceUser)].filter(Boolean))].slice(0,100);
  reading=true;
  try{
   const values=await request('/presence',{method:'POST',body:JSON.stringify({userIds:ids})});
   if(stopped||uid!==user()||version!==generation)return;
   const at=now();cache=new Map(Object.entries(values||{}).map(([id,value])=>[id,{value,at}]));render();
  }catch{ /* A failed read must not claim a user is online indefinitely. */ }
  finally{reading=false;}
 }
 async function flush(){
  timer=null;
  if(stopped||!dirty||!user()||!visible()||sending)return;
  const wait=25000-(now()-lastSent);
  if(wait>0){timer=win.setTimeout(flush,wait);return;}
  const ageMs=Math.max(0,Math.round(now()-lastAction));
  if(ageMs>30000){dirty=false;return;}
  dirty=false;sending=true;lastSent=now();const uid=user(),version=generation;
  try{
   await request('/me/activity',{method:'POST',body:JSON.stringify({ageMs})});
   if(!stopped&&uid===user()&&version===generation)void refresh();
  }catch{ /* No autonomous retry: a later gesture may try again. */ }
  finally{sending=false;if(dirty&&!timer&&!stopped)timer=win.setTimeout(flush,25000);}
 }
 function activity(){if(stopped||!user()||!visible())return;lastAction=now();dirty=true;if(!timer)void flush();}
 function gesture(event){if(event.isTrusted)activity();}
 function foreground(){if(visible()){activity();void refresh();}else{dirty=false;win.clearTimeout(timer);timer=null;}}
 function clear(){generation++;cache.clear();dirty=false;win.clearTimeout(timer);timer=null;lastSent=-Infinity;render();}
 for(const name of ['pointerdown','keydown','input','wheel','touchmove'])doc.addEventListener(name,gesture,{capture:true,passive:true});
 doc.addEventListener('visibilitychange',foreground);
 win.addEventListener('focus',foreground);
 doc.addEventListener('session-unauthorized',clear);
 const poll=win.setInterval(()=>void refresh(),15000);
 return {start(){activity();void refresh();},refresh,clear,destroy(){
  stopped=true;clear();win.clearInterval(poll);
  for(const name of ['pointerdown','keydown','input','wheel','touchmove'])doc.removeEventListener(name,gesture,true);
  doc.removeEventListener('visibilitychange',foreground);win.removeEventListener('focus',foreground);doc.removeEventListener('session-unauthorized',clear);
 }};
}
