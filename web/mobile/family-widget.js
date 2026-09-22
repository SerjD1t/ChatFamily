import {isNative,nativeCapabilities,registerNativePlugin} from './runtime.js';
let pluginPromise,refreshTimer,listener,visibilityHandler;
async function plugin(){
 if(!isNative)return null;
 pluginPromise??=(async()=> (await nativeCapabilities()).familyWidget?registerNativePlugin('FamilyWidget'):null)();
 return pluginPromise;
}
export function validWidgetAction(value,user){
 const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
 return !!value&&value.userId===user&&id(value.familyId)&&['list','item','task','purchase','chat'].includes(value.action)&&(!['item','chat'].includes(value.action)||id(value.itemId));
}
export async function clearFamilyWidgets(){const native=await plugin();if(native)await native.session({userId:''});}
export function refreshFamilyWidgets(){
 if(!isNative)return;
 clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{void plugin().then(p=>p?.refresh()).catch(()=>{});},500);
}
export async function initFamilyWidgets({user,open,onError}){
 try {
 const native=await plugin();if(!native)return;
 if(listener)await listener.remove();
 if(visibilityHandler)document.removeEventListener('visibilitychange',visibilityHandler);
 await native.session({userId:user});
 let opening=false;
 const consume=async()=>{
  if(opening)return;opening=true;
  try{const action=await native.consumeAction();if(validWidgetAction(action,user))await open(action);}
  catch{onError();}finally{opening=false;}
 };
 listener=await native.addListener('open',consume);await consume();
 visibilityHandler=()=>{if(!document.hidden){refreshFamilyWidgets();void consume();}};
 document.addEventListener('visibilitychange',visibilityHandler);
 }catch{onError();}
}
if(isNative){
 document.addEventListener('session-unauthorized',()=>{void clearFamilyWidgets().catch(()=>{});});
 document.addEventListener('family-needs-updated',refreshFamilyWidgets);
}
