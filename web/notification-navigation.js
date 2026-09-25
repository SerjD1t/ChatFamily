export function notificationTarget(value) {
  if(!value || typeof value.conversationID!=='string' || !value.conversationID || value.conversationID.length>200)return null;
  if(value.messageID && (typeof value.messageID!=='string'||value.messageID.length>200))return null;
  return {conversationID:value.conversationID,messageID:value.messageID||''};
}
export function initNotificationNavigation({ready,open,onError}) {
  const storageKey='notification.pending',ttl=600000;
  let pending=null,generation=0,running=false,timer=null,attempts=0,source=null,lastTime=0,done='';
  try{pending=JSON.parse(sessionStorage.getItem(storageKey)||'null');done=sessionStorage.getItem('notification.done')||'';}catch{}
  const params=new URLSearchParams(location.hash.slice(1));
  if(params.has('conversation'))pending={conversationID:params.get('conversation'),messageID:params.get('message'),requestID:params.get('notification')||'',clickedAt:Number(params.get('clickedAt'))||Date.now()};
  function save(){try{if(pending)sessionStorage.setItem(storageKey,JSON.stringify(pending));else sessionStorage.removeItem(storageKey);}catch{}}
  if(pending&&!notificationTarget(pending))pending=null;
  if(pending){pending.clickedAt ||= Date.now();lastTime=pending.clickedAt;}save();
  function post(message){try{(navigator.serviceWorker?.controller||source)?.postMessage(message);}catch{}}
  function ack(id){if(id)post({type:'notification.ack',requestID:id});}
  function clear(){pending=null;save();clearTimeout(timer);timer=null;}
  async function receive(value,worker){
    const target=notificationTarget(value);if(!target)return;
    if(worker)source=worker;
    const requestID=typeof value.requestID==='string'?value.requestID:'';
    const clickedAt=Number(value.clickedAt)||Date.now();
    if(requestID&&requestID===done){ack(requestID);return;}
    if(clickedAt<lastTime||Date.now()-clickedAt>ttl)return;
    if(requestID&&pending?.requestID===requestID){await flush();return;}
    generation++;lastTime=clickedAt;attempts=0;clearTimeout(timer);
    pending={...target,requestID,clickedAt};save();await flush();
  }
  async function flush(){
    if(!ready()||!pending||running)return;
    if(pending.requestID&&pending.requestID===done){ack(done);clear();return;}
    if(Date.now()-pending.clickedAt>ttl){ack(pending.requestID);clear();return;}
    clearTimeout(timer);timer=null;
    const target=pending,version=generation;running=true;
    try{
      const result=await open(notificationTarget(target),()=>version===generation);
      if(version!==generation)return;
      if(result===false)throw Error('Navigation interrupted');
      done=target.requestID;try{sessionStorage.setItem('notification.done',done);}catch{}
      ack(done);clear();
      if(location.hash.includes('conversation='))history.replaceState(null,'',location.pathname+location.search);
    }catch(error){
      if(version===generation){
        if(error.permanent || [403,404].includes(error.status)){ack(target.requestID);clear();}
        else if(attempts<3){const delay=[1000,3000,10000][attempts++];timer=setTimeout(()=>{timer=null;void flush();},delay);timer?.unref?.();}
        if(attempts<=1||!pending)onError(error);
      }
    }finally{running=false;if(pending&&version!==generation)void flush();}
  }
  function resume(){post({type:'notification.ready'});void flush();}
  navigator.serviceWorker?.addEventListener('message',event=>{
    if(event.data?.type==='notification.open')void receive(event.data,event.source);
  });
  navigator.serviceWorker?.addEventListener('controllerchange',resume);
  globalThis.window?.addEventListener('pageshow',resume);
  globalThis.window?.addEventListener('online',resume);
  globalThis.window?.addEventListener('focus',resume);
  globalThis.document?.addEventListener('visibilitychange',()=>{if(!document.hidden)resume();});
  navigator.serviceWorker?.ready?.then(registration=>{source=registration.active;resume();}).catch(()=>{});
  return {receive,flush,resume};
}
