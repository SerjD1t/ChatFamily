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
  const data = event.data ? event.data.json() : { title: 'Семейный чат', body: 'Новое сообщение' };
  event.waitUntil(Promise.all([refreshBadge(),self.registration.showNotification(data.title || 'Семейный чат', { body: data.body || 'Новое сообщение', data })]));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => windows[0] ? windows[0].focus() : clients.openWindow('/')));
});
