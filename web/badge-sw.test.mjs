import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('push badge fetches authoritative total; failures do not suppress notifications',async()=>{
 const handlers={},values=[],notifications=[];let response={ok:true,json:async()=>({count:12})};
 const self={navigator:{setAppBadge:async n=>values.push(n),clearAppBadge:async()=>values.push(0)},registration:{showNotification:async title=>notifications.push(title)},addEventListener:(name,fn)=>handlers[name]=fn};
 vm.runInNewContext(readFileSync(new URL('./sw.js',import.meta.url),'utf8'),{self,fetch:async()=>{if(response instanceof Error)throw response;return response},setTimeout,clearTimeout,AbortController});
 async function push(){let done;handlers.push({data:{json:()=>({title:'Synthetic'})},waitUntil:p=>done=p});await done;}
 await push();response={status:401};await push();response=Error('offline');await push();
 assert.deepEqual(values,[12,0]);assert.equal(notifications.length,3);
});
