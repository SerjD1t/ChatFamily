import test from 'node:test';
import assert from 'node:assert/strict';
import {createBadge} from './badge.js';
test('badge uses absolute count, validates account and preserves value on failure',async()=>{
 const values=[];let response={userID:'u',count:9};
 const badge=createBadge({user:()=> 'u',request:async()=>{if(response instanceof Error)throw response;return response},apply:async n=>values.push(n)});
 await badge.refresh();await badge.refresh();response={userID:'u',count:0};await badge.refresh();
 response=Error('offline');await badge.refresh();response={userID:'other',count:100};await badge.refresh();
 response={userID:'u',count:-1};await badge.refresh();assert.deepEqual(values,[9,9,0]);
});
test('logout invalidates in-flight badge request',async()=>{
 let resolve;const values=[];const badge=createBadge({user:()=> 'u',request:()=>new Promise(r=>resolve=r),apply:async n=>values.push(n)});
 const pending=badge.refresh();await badge.clear();resolve({userID:'u',count:4});await pending;assert.deepEqual(values,[0]);
});
test('concurrent refreshes are serialized and coalesced',async()=>{
 let resolve,calls=0;const values=[];
 const badge=createBadge({user:()=> 'u',request:async()=>{calls++;return calls===1?new Promise(r=>resolve=r):{userID:'u',count:2}},apply:async n=>values.push(n)});
 const first=badge.refresh();badge.refresh();badge.refresh();resolve({userID:'u',count:5});await first;
 assert.equal(calls,2);assert.deepEqual(values,[5,2]);
});
