export function notificationTarget(value) {
  if(!value || typeof value.conversationID!=='string' || !value.conversationID || value.conversationID.length>200)return null;
  if(value.messageID && (typeof value.messageID!=='string'||value.messageID.length>200))return null;
  return {conversationID:value.conversationID,messageID:value.messageID||''};
}
export function initNotificationNavigation({ready,open,onError}) {
  let pending=null, generation=0;
  try{pending=notificationTarget(JSON.parse(sessionStorage.getItem('notification.pending')||'null'));}catch{}
  const params=new URLSearchParams(location.hash.slice(1));
  if(params.has('conversation'))pending=notificationTarget({conversationID:params.get('conversation'),messageID:params.get('message')});
  if(pending)try{sessionStorage.setItem('notification.pending',JSON.stringify(pending));}catch{}
  async function receive(value){
    const target=notificationTarget(value);if(!target)return;
    pending=target;try{sessionStorage.setItem('notification.pending',JSON.stringify(target));}catch{}await flush();
  }
  async function flush(){
    if(!ready()||!pending)return;
    const target=pending;pending=null;try{sessionStorage.removeItem('notification.pending');}catch{}const version=++generation;
    try{await open(target,()=>version===generation);if(version===generation&&location.hash.includes('conversation='))history.replaceState(null,'',location.pathname+location.search);}
    catch{if(version===generation)onError();}
  }
  navigator.serviceWorker?.addEventListener('message',event=>{
    if(event.data?.type==='notification.open')void receive(event.data);
  });
  return {receive,flush};
}
