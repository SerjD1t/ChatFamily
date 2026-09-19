import {isNative, nativeCapabilities, registerNativePlugin} from './mobile/runtime.js';

// Serialize reads/writes: a slow response must never overwrite a newer count or logout.
export function createBadge({request, apply, user}) {
 let running=false,pending=false,generation=0,writes=Promise.resolve();
 const write=count=>(writes=writes.catch(()=>{}).then(()=>apply(count)));
 async function refresh(){
  pending=true;if(running)return;
  running=true;
  try { while(pending){
   pending=false;const version=generation,uid=user();if(!uid)continue;
   try { const result=await request('/me/unread');
    if(version===generation&&uid===user()&&result.userID===uid&&Number.isSafeInteger(result.count)&&result.count>=0)await write(result.count);
   }catch{} // Offline/unsupported/denied must not break chat or clear a valid count.
  }}finally{running=false}
 }
 async function clear(){generation++;pending=false;await write(0).catch(()=>{});}
 return {refresh,clear};
}

export async function applyAppBadge(count){
 if(isNative){
  if((await nativeCapabilities()).appBadge)await registerNativePlugin('PushEnvironment').setBadge({count});
 }else if(count===0&&navigator.clearAppBadge)await navigator.clearAppBadge();
 else if(navigator.setAppBadge)await navigator.setAppBadge(count);
}
