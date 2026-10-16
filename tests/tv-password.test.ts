import {test} from 'node:test';
import assert from 'node:assert/strict';
import {listenForTvPassword} from '../src/web/tv-password';

function fixture(linked=true) {
  const handlers=new Map<string,Function>(), messages:unknown[]=[], displayed:string[]=[];
  const controller={postMessage(data:unknown,origin:string){messages.push({data,origin});}};
  const host={opener:linked?controller:null,location:{origin:'https://dock.test'},
    addEventListener(type:string,handler:Function){handlers.set(type,handler);}};
  listenForTvPassword(value=>displayed.push(value),host as unknown as Window);
  function receive(data:unknown,source:unknown=controller,origin='https://dock.test') {
    handlers.get('message')?.({data,source,origin});
  }
  return {handlers,messages,displayed,receive,controller};
}

test('ordinary leaderboard tabs do not subscribe to password controls',()=>{
  const f=fixture(false);
  assert.equal(f.handlers.size,0);assert.deepEqual(f.messages,[]);
});

test('TV passwords are accepted only from the exact opener and matching origin',()=>{
  const f=fixture(), message={type:'dock.tv.password',password:'test-orbit'};
  f.receive(message,{},'https://dock.test');
  f.receive(message,f.controller,'https://other.test');
  f.receive(message,null);
  assert.deepEqual(f.displayed,[]);
  f.receive(message);
  assert.deepEqual(f.displayed,['test-orbit']);
  assert.deepEqual(f.messages,[{data:{type:'dock.tv.ready'},origin:'https://dock.test'}]);
});

test('TV password messages reject malformed or oversized data and support hiding',()=>{
  const f=fixture();
  for(const data of [null,{},'test',{type:'other',password:'test'},
    {type:'dock.tv.password',password:123},{type:'dock.tv.password',password:'x'.repeat(129)}])f.receive(data);
  assert.deepEqual(f.displayed,[]);
  f.receive({type:'dock.tv.password',password:'<sample>& orbit'});
  f.receive({type:'dock.tv.password',password:''});
  assert.deepEqual(f.displayed,['<sample>& orbit','']);
});

test('leaving a linked TV page clears the password and resets controller readiness',()=>{
  const f=fixture();
  f.receive({type:'dock.tv.password',password:'test-orbit'});
  f.handlers.get('pagehide')!();
  assert.deepEqual(f.displayed,['test-orbit','']);
  assert.deepEqual(f.messages.at(-1),{data:{type:'dock.tv.not-ready'},origin:'https://dock.test'});
});
