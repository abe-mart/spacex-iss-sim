import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eventStart} from '../src/shared/start';
test('seeded scenarios are reproducible, varied and have equal initial distance',()=>{
  const positions=new Set<string>();
  for(let i=0;i<1000;i++){
    const p=eventStart(String(i));
    assert.deepEqual(p,eventStart(String(i)));
    assert.equal(p.x,200);
    assert.ok(Math.abs(Math.hypot(p.y,p.z)-32)<.001);
    positions.add(JSON.stringify(p));
  }
  assert.ok(positions.size>990);
});
