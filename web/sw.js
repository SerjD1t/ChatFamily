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
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const {conversationID,messageID}=event.notification.data||{};
  if(typeof conversationID!=='string'||conversationID.length>200)return;
  const target={conversationID,messageID:typeof messageID==='string'?messageID:''};
  const url=new URL('/',self.location.origin);
  url.hash=new URLSearchParams({conversation:target.conversationID,message:target.messageID}).toString();
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    const window=windows.find(w=>new URL(w.url).origin===self.location.origin);
    if(window){await window.focus();window.postMessage({type:'notification.open',...target});}
    else await clients.openWindow(url.href);
  }));
});
