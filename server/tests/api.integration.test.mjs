import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';

test('API authentication, queue and reject lifecycle',async()=>{
 const key='integration-test-secret-key-at-least-32-characters';
 const port=39000+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['index.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,AGENTFORGE_API_KEY:key,PORT:String(port),DATABASE_URL:''},stdio:'ignore'});
 const base='http://127.0.0.1:'+port+'/api';
 try{
  let ready=false;
  for(let i=0;i<40;i++){if(child.exitCode!==null)break;try{const r=await fetch(base+'/health',{headers:{'X-AgentForge-Key':key}});if(r.ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready,'server should start');
  const unauth=await fetch(base+'/tasks');assert.equal(unauth.status,401);
  const bad=await fetch(base+'/tasks',{method:'POST',headers:{'X-AgentForge-Key':key,'Content-Type':'application/json'},body:JSON.stringify({task:''})});assert.equal(bad.status,400);
  const headers={'X-AgentForge-Key':key,'Content-Type':'application/json'};
  const created=await fetch(base+'/tasks',{method:'POST',headers,body:JSON.stringify({task:'Write a project plan'})});assert.equal(created.status,201);
  const task=await created.json();assert.equal(task.status,'Pending approval');
  const list=await fetch(base+'/tasks',{headers});assert.ok((await list.json()).tasks.some(x=>x.id===task.id));
  const rejected=await fetch(base+'/tasks/'+task.id+'/reject',{method:'POST',headers});assert.equal(rejected.status,200);assert.equal((await rejected.json()).status,'Rejected');
  const repeated=await fetch(base+'/tasks/'+task.id+'/reject',{method:'POST',headers});assert.equal(repeated.status,409);
 }finally{child.kill();await delay(100)}
});

test('approved task executes against mocked AI and cannot execute twice',async()=>{
 const key='integration-test-secret-key-at-least-32-characters';
 const mock=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/run'){res.writeHead(404).end();return;}
  let body='';for await(const chunk of req)body+=chunk;
  assert.equal(JSON.parse(body).task,'Test approved workflow');
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({result:'Reviewed plan',trace:[{agent:'Planner',output:'Plan ready'},{agent:'Reviewer',output:'Reviewed plan'}]}));
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const aiPort=mock.address().port;
 const port=40000+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['index.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,AGENTFORGE_API_KEY:key,PORT:String(port),DATABASE_URL:'',AI_SERVICE_URL:'http://127.0.0.1:'+aiPort},stdio:'ignore'});
 const base='http://127.0.0.1:'+port+'/api';
 const headers={'X-AgentForge-Key':key,'Content-Type':'application/json'};
 try{
  let ready=false;
  for(let i=0;i<40;i++){if(child.exitCode!==null)break;try{const response=await fetch(base+'/health',{headers});if(response.ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready,'API server should start');
  const created=await fetch(base+'/tasks',{method:'POST',headers,body:JSON.stringify({task:'Test approved workflow'})});
  assert.equal(created.status,201);
  const task=await created.json();
  const approved=await fetch(base+'/tasks/'+task.id+'/approve',{method:'POST',headers});
  assert.equal(approved.status,200);
  const output=await approved.json();
  assert.equal(output.status,'Completed');assert.equal(output.result,'Reviewed plan');assert.equal(output.trace.length,2);
  const again=await fetch(base+'/tasks/'+task.id+'/approve',{method:'POST',headers});
  assert.equal(again.status,409);
 }finally{
  child.kill();
  await new Promise(resolve=>mock.close(resolve));
 }
});
