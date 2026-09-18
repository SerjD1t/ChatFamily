import test from 'node:test';
import assert from 'node:assert/strict';
import {metadata} from './prepare-update.mjs';
const badging="package: name='site.chatfamily.app' versionCode='5' versionName='0.5.0'\nsdkVersion:'24'\napplication-debuggable\n";
test('debug allowed, fixed artifact path and hash',()=>{
 const r=metadata(badging,Buffer.from('synthetic'));assert.equal(r.debug,true);assert.equal(r.path,'/downloads/android/chatfamily-5.apk');assert.equal(r.sha256.length,64);
 assert.equal(metadata(badging.replace('application-debuggable',''),Buffer.from('x')).debug,false);
});
test('reject wrong package, invalid SDK, empty APK and oversized notes',()=>{
 assert.throws(()=>metadata(badging.replace('site.chatfamily.app','other.app'),Buffer.from('x')));
 assert.throws(()=>metadata(badging.replace("'24'","'1'"),Buffer.from('x')));
 assert.throws(()=>metadata(badging,Buffer.alloc(0)));
 assert.throws(()=>metadata(badging,Buffer.from('x'),'x'.repeat(4001)));
});
