let badgeWork=Promise.resolve();
function refreshBadge(){
  badgeWork=badgeWork.catch(()=>{}).then(async()=>{
    if(!self.navigator?.setAppBadge)return;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try {
      const response=await fetch('/api/v1/me/unread',{credentials:'include',cache:'no-store',signal:controller.signal});
      if(response.status===401){await self.navigator.clearAppBadge();return;}
      if(!response.ok)return;
      const {count}=await response.json();
      if(!Number.isSafeInteger(count)||count<0)return;
      if(count===0)await self.navigator.clearAppBadge();else await self.navigator.setAppBadge(count);
    }catch{}finally{clearTimeout(timer);} // Never prevent the required visible push notification.
  });
  return badgeWork;
}
self.addEventListener('push', event => {
  let data={};try{data=event.data?.json()||{};}catch{}
  event.waitUntil(Promise.all([refreshBadge(),self.registration.showNotification(data.title || 'ChatFamily', { body: data.body || 'Новое сообщение', icon:'/icon-indigo-192.png', badge:'/badge-dialog.png', data })]));
});
// Latest click only, routing IDs without message text; survives worker suspension.
const clickCache='notification-navigation-v1', clickKey='/__notification_navigation__', clickTTL=600000;
let clickWork=Promise.resolve(), clickMemory=null, clickSerial=0,lastClickTime=0;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(clients.claim()));
function withClick(fn){const work=clickWork.catch(()=>{}).then(fn);clickWork=work;return work;}
async function readClick(){
  try{const response=await (await caches.open(clickCache)).match(clickKey);clickMemory=response?await response.json():null;}catch{}
  if(clickMemory && Date.now()-clickMemory.clickedAt>clickTTL)await writeClick(null);
  return clickMemory;
}
async function writeClick(value){
  clickMemory=value;
  try{const cache=await caches.open(clickCache);if(value)await cache.put(clickKey,new Response(JSON.stringify(value)));else await cache.delete(clickKey);}catch{}
}
function sendClick(client,target){try{client.postMessage({type:'notification.open',...target});}catch{}}
self.addEventListener('message',event=>{
  const client=event.source;
  if(!client?.url || new URL(client.url).origin!==self.location.origin)return;
  if(!['notification.ready','notification.ack'].includes(event.data?.type))return;
  event.waitUntil(withClick(async()=>{
    const target=await readClick();if(!target)return;
    if(target.clientID && target.clientID!==client.id){
      // A closed/recreated client can hand off; a still-live client retains ownership.
      if(await clients.get(target.clientID))return;
      if(event.data.type==='notification.ack')return;
    }
    if(event.data.type==='notification.ack'){
      if(event.data.requestID===target.requestID)await writeClick(null);
    }else{
      target.clientID=client.id;await writeClick(target);sendClick(client,target);
    }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const {conversationID,messageID}=event.notification.data||{};
  if(typeof conversationID!=='string'||!conversationID||conversationID.length>200)return;
  lastClickTime=Math.max(Date.now(),lastClickTime+1);
  const target={conversationID,messageID:typeof messageID==='string'&&messageID.length<=200?messageID:'',clickedAt:lastClickTime,requestID:`${lastClickTime}-${++clickSerial}`};
  const url=new URL('/',self.location.origin);
  url.hash=new URLSearchParams({conversation:target.conversationID,message:target.messageID}).toString();
  url.hash+='&notification='+encodeURIComponent(target.requestID)+'&clickedAt='+target.clickedAt;
  // Persist in click order, before any potentially slow window operations.
  const saved=withClick(()=>writeClick(target));
  event.waitUntil((async()=>{
    await saved;
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    const window=windows.filter(w=>new URL(w.url).origin===self.location.origin)
      .sort((a,b)=>Number(!!b.focused)-Number(!!a.focused)||Number(b.visibilityState==='visible')-Number(a.visibilityState==='visible'))[0];
    const selected=await withClick(async()=>{
      const current=await readClick();if(current?.requestID!==target.requestID)return false;
      current.clientID=window?.id||'';await writeClick(current);return true;
    });
    if(!selected)return;
    if(window){
      // A failed focus must not suppress delivery or reload a live draft.
      sendClick(window,target);
      try{await window.focus();return;}catch{}
    }
    try{
      const opened=await clients.openWindow(url.href);
      if(opened)await withClick(async()=>{
        const current=await readClick();if(current?.requestID!==target.requestID)return;
        current.clientID=opened.id;await writeClick(current);sendClick(opened,current);
      });
    }catch{} // The persisted target is pulled on the next client-ready handshake.
  })());
});
