import test from 'node:test';
import assert from 'node:assert/strict';
import {validWidgetAction,initFamilyWidgets,clearFamilyWidgets} from './mobile/family-widget.js';

test('widget navigation is account bound and accepts only known actions and identifiers',()=>{
 const value={userId:'self',familyId:'family-1',action:'item',itemId:'item-1'};
 assert.equal(validWidgetAction(value,'self'),true);
 assert.equal(validWidgetAction(value,'other'),false);
 for(const patch of [{familyId:'../private'},{action:'url'},{itemId:''},{itemId:'x?y=z'}]){
  assert.equal(validWidgetAction({...value,...patch},'self'),false);
 }
 for(const action of ['list','task','purchase'])assert.equal(validWidgetAction({...value,action,itemId:''},'self'),true);
 assert.equal(validWidgetAction(null,'self'),false);
 assert.equal(validWidgetAction({...value,action:'chat'},'self'),true);
 assert.equal(validWidgetAction({...value,action:'chat',itemId:''},'self'),false);
});
test('browser without native widgets remains unaffected',async()=>{
 await initFamilyWidgets({user:'self',open:()=>assert.fail('Unexpected navigation'),onError:()=>assert.fail('Unexpected native call')});
 await clearFamilyWidgets();
});
