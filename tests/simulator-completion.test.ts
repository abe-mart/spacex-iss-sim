import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

function simulator() {
  const context:any={console,toleranceRotation:.2,toleranceRate:.004,PHYSICS_HZ:60,
    simStepCount:120,simStepBudget:0,simPaused:true,isEventsEnabled:true,isIntroStarted:true,isGameOver:false,isWarpComplete:true,
    camera:{position:{x:0,y:0,z:.15},rotation:{x:0,y:0,z:0}},issObject:{position:{x:0,y:0,z:0}},
    motionVector:{x:0,y:0,z:-.001},currentRotationX:0,currentRotationY:0,currentRotationZ:0,
    targetRotationX:0,targetRotationY:0,targetRotationZ:0,translationPulseSize:.001,rotationPulseSize:.5,isGravity:true};
  context.window=context;context.dragonBridge={url:null};
  context.hideInterface=()=>{context.isGameOver=true;context.camera.position.z=10;};
  context.setTimeout=(fn:()=>void,ms:number)=>{if(ms!==500)setImmediate(fn);};
  createContext(context);
  runInContext(readFileSync('iss-sim.spacex.com/js/api.js','utf8'),context);
  return context;
}

test('completion telemetry remains at contact while the ending animation moves the camera',()=>{
  const sim=simulator();sim.hideInterface('success');
  const result=sim.dragon.getState();
  assert.equal(result.status,'success');assert.equal(result.range,.15);assert.equal(result.time_s,2);
  result.attitude.yaw=99;
  assert.equal(sim.dragon.getState().attitude.yaw,0);
});

test('reset applies the scenario in HUD coordinates and clears velocity and clock',async()=>{
  const sim=simulator();
  const vector=(object:any)=>{object.set=(x:number,y:number,z:number)=>Object.assign(object,{x,y,z});return object;};
  vector(sim.camera.position);vector(sim.motionVector);sim.translationVector=vector({});
  sim.gsap={killTweensOf:()=>{}};sim.resetPosition=()=>{};
  sim.issObject.position={x:4,y:8,z:-150};
  const result=await sim.dragon.command('reset',{start_position:{x:200,y:-16,z:27.713}});
  assert.equal(result.ok,true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.state.position)),{x:200,y:-16,z:27.713});
  assert.equal(result.state.time_s,0);
  assert.equal(result.state.velocity.x,0);assert.equal(result.state.velocity.y,0);assert.equal(result.state.velocity.z,0);
  const invalid=await sim.dragon.command('reset',{start_position:{x:0,y:0,z:0}});
  assert.equal(invalid.ok,false);
});

test('the final Python step resolves when docking clears and the physics loop decrements its budget',async()=>{
  const sim=simulator();
  const command=sim.dragon.command('step',{seconds:.2});
  setImmediate(()=>{sim.hideInterface('success');sim.simStepBudget--;});
  const result=await command;
  assert.equal(result.ok,true);assert.equal(result.state.status,'success');assert.equal(sim.simStepBudget,0);
});
