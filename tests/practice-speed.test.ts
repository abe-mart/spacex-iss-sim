import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
test('practice acceleration advances fixed steps, clamps invalid rates, and leaves turn-based steps unchanged',()=>{
  const source=readFileSync('iss-sim.spacex.com/js/threed.js','utf8');
  const advance=source.slice(source.indexOf('function advancePhysics()'),source.indexOf('function animate()',source.indexOf('function advancePhysics()')));
  for(const speed of [1,2,4,8,100]){
    const sim:any={window:{dockSimulationSpeed:()=>speed},performance:{now:()=>100},physicsLastTime:0,physicsAccumulatorMs:0,physicsStepMs:1000/60,physicsMaxStepsPerFrame:10,simPaused:false,simStepBudget:0,simStepsPerFrameWhenStepping:600,count:0};
    sim.physicsStep=()=>sim.count++;createContext(sim);runInContext(advance,sim);sim.advancePhysics();
    assert.ok(Math.abs(sim.count-6*(speed===100?1:speed))<=1);
    sim.count=0;sim.simPaused=true;sim.simStepBudget=12;sim.advancePhysics();assert.equal(sim.count,12);assert.equal(sim.simStepBudget,0);
  }
});
