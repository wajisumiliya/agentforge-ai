import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

test('API authentication, queue and reject lifecycle',async()=>{
 const key='integration-test-secret-key-at-least-32-characters';
 const port=39000+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['index.js'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,AGENTFORGE_API_KEY:key,PORT:String(port),DATABASE_URL:''},stdio:'ignore'});
 const base='http://127.0.0.1:'+port+'/api';
 try{
  let ready=false;
  for(let i=0;i<40;i++){if(child.exitCode!==null)break;try{const r=await fetch(base+'/health',{headers:{'X-AgentForge-Key':key}});if(r.ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready,'server should start');
  const unauth=await fetch(base+'/tasks');assert.equal(unauth.status,401);

  await delay(1);
  const bad=await fetch(base+'/tasks',{method:'POST',headers:{'X-AgentForge-Key':key,'Content-Type':'application/json'},body:JSON.stringify({task:''})});assert.equal(bad.status,400);
  const headers={'X-AgentForge-Key':key,'Content-Type':'application/json'};
  const created=await fetch(base+'/tasks',{method:'POST',headers,body:JSON.stringify({task:'Write a project plan'})});assert.equal(created.status,201);
  const task=await created.json();assert.equal(task.status,'Pending approval');
  const list=await fetch(base+'/tasks',{headers});assert.ok((await list.json()).tasks.some(x=>x.id===task.id));
  const rejected=await fetch(base+'/tasks/'+task.id+'/reject',{method:'POST',headers});assert.equal(rejected.status,200);assert.equal((await rejected.json()).status,'Rejected');
  const repeated=await fetch(base+'/tasks/'+task.id+'/reject',{method:'POST',headers});assert.equal(repeated.status,409);
  const invalidId=await fetch(base+'/tasks/not-a-uuid/reject',{method:'POST',headers});assert.equal(invalidId.status,404);
  for(let i=0;i<9;i++){const attempt=await fetch(base+'/tasks');assert.equal(attempt.status,401)}
  const limited=await fetch(base+'/tasks');assert.equal(limited.status,429);
  const blocked=await fetch(base+'/tasks',{headers});assert.equal(blocked.status,429);
 }finally{child.kill();await delay(100)}
});

test('approved task executes against mocked AI and cannot execute twice',async()=>{
 const key='integration-test-secret-key-at-least-32-characters';
 const mock=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/run-stream'){res.writeHead(404).end();return;}
  let body='';for await(const chunk of req)body+=chunk;
  assert.equal(JSON.parse(body).task,'Test approved workflow');
  res.setHeader('Content-Type','application/x-ndjson');
  const trace=[{agent:'Planner',output:'Plan ready'},{agent:'Researcher',output:'Research ready'},{agent:'Developer',output:'Draft ready'},{agent:'Reviewer',output:'Reviewed plan'}];
  res.write(JSON.stringify({type:'progress',agent:'Planner',trace:trace.slice(0,1)})+String.fromCharCode(10));
  await delay(300);
  res.end([JSON.stringify({type:'progress',agent:'Reviewer',trace}),JSON.stringify({type:'complete',result:'Reviewed plan',trace})].join(String.fromCharCode(10))+String.fromCharCode(10));
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const aiPort=mock.address().port;
 const port=40000+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['index.js'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,AGENTFORGE_API_KEY:key,PORT:String(port),DATABASE_URL:'',AI_SERVICE_URL:'http://127.0.0.1:'+aiPort},stdio:'ignore'});
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
  assert.equal(approved.status,202);
  const accepted=await approved.json();
  assert.equal(accepted.status,'Running');
  let output;
  let sawProgress=false;
  for(let i=0;i<50;i++){
    const response=await fetch(base+'/tasks',{headers});
    output=(await response.json()).tasks.find(x=>x.id===task.id);
    if(output?.status==='Running'&&output.trace?.length===1)sawProgress=true;
    if(output?.status==='Completed')break;
    await delay(100);
  }
  assert.equal(sawProgress,true,'intermediate agent progress should be visible');
  assert.equal(output.status,'Completed');assert.equal(output.result,'Reviewed plan');assert.equal(output.trace.length,4);
  const again=await fetch(base+'/tasks/'+task.id+'/approve',{method:'POST',headers});
  assert.equal(again.status,409);
 }finally{
  child.kill();
  await new Promise(resolve=>mock.close(resolve));
 }
});

test('AI streaming failure becomes a failed task with a visible error',async()=>{
 const key='integration-test-secret-key-at-least-32-characters';
 const mock=createServer(async(req,res)=>{
  for await(const _ of req){}
  res.setHeader('Content-Type','application/x-ndjson');
  res.end(JSON.stringify({type:'error',error:'Mock AI unavailable'})+String.fromCharCode(10));
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const port=41000+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['index.js'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,AGENTFORGE_API_KEY:key,PORT:String(port),DATABASE_URL:'',AI_SERVICE_URL:'http://127.0.0.1:'+mock.address().port},stdio:'ignore'});
 const base='http://127.0.0.1:'+port+'/api';
 const headers={'X-AgentForge-Key':key,'Content-Type':'application/json'};
 try{
  let ready=false;
  for(let i=0;i<40;i++){if(child.exitCode!==null)break;try{if((await fetch(base+'/health',{headers})).ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready);
  const created=await fetch(base+'/tasks',{method:'POST',headers,body:JSON.stringify({task:'Test failure'})});
  assert.equal(created.status,201);
  const task=await created.json();
  assert.equal((await fetch(base+'/tasks/'+task.id+'/approve',{method:'POST',headers})).status,202);
  let latest;
  for(let i=0;i<50;i++){
   latest=(await (await fetch(base+'/tasks',{headers})).json()).tasks.find(x=>x.id===task.id);
   if(latest?.status==='Failed')break;
   await delay(100);
  }
  assert.equal(latest.status,'Failed');
  assert.equal(latest.error,'Mock AI unavailable');
 }finally{
  child.kill();
  await new Promise(resolve=>mock.close(resolve));
 }
});

test('oversized streamed AI response fails safely',async()=>{
 const key='integration-test-secret-key-at-least-32-characters';
 const mock=createServer(async(req,res)=>{
  for await(const _ of req){}
  res.setHeader('Content-Type','application/x-ndjson');
  res.end(JSON.stringify({type:'progress',trace:[{agent:'Planner',output:'x'.repeat(1100000)}]})+String.fromCharCode(10));
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const port=42000+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['index.js'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,AGENTFORGE_API_KEY:key,PORT:String(port),DATABASE_URL:'',AI_SERVICE_URL:'http://127.0.0.1:'+mock.address().port},stdio:'ignore'});
 const base='http://127.0.0.1:'+port+'/api';
 const headers={'X-AgentForge-Key':key,'Content-Type':'application/json'};
 try{
  let ready=false;
  for(let i=0;i<40;i++){if(child.exitCode!==null)break;try{if((await fetch(base+'/health',{headers})).ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready);
  const created=await fetch(base+'/tasks',{method:'POST',headers,body:JSON.stringify({task:'Test stream size limit'})});
  const task=await created.json();
  assert.equal((await fetch(base+'/tasks/'+task.id+'/approve',{method:'POST',headers})).status,202);
  let latest;
  for(let i=0;i<50;i++){
   latest=(await (await fetch(base+'/tasks',{headers})).json()).tasks.find(x=>x.id===task.id);
   if(latest?.status==='Failed')break;
   await delay(100);
  }
  assert.equal(latest.status,'Failed');
  assert.match(latest.error,/too large/);
 }finally{
  child.kill();
  await new Promise(resolve=>mock.close(resolve));
 }
});

test('multiple valid progress events in one large chunk are accepted',async()=>{
 const key='integration-test-secret-key-at-least-32-characters';
 const mock=createServer(async(req,res)=>{
  for await(const _ of req){}
  res.setHeader('Content-Type','application/x-ndjson');
  const trace=[];
  const lines=[];
  for(const agent of ['Planner','Researcher','Developer','Reviewer']){
   trace.push({agent,output:'x'.repeat(280000)});
   lines.push(JSON.stringify({type:'progress',agent,trace:trace.slice()}));
  }
  lines.push(JSON.stringify({type:'complete',result:'Done',trace:[{agent:'Planner',output:'Plan'},{agent:'Researcher',output:'Research'},{agent:'Developer',output:'Draft'},{agent:'Reviewer',output:'Done'}]}));
  res.end(lines.join(String.fromCharCode(10))+String.fromCharCode(10));
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const port=43000+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['index.js'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,AGENTFORGE_API_KEY:key,PORT:String(port),DATABASE_URL:'',AI_SERVICE_URL:'http://127.0.0.1:'+mock.address().port},stdio:'ignore'});
 const base='http://127.0.0.1:'+port+'/api';
 const headers={'X-AgentForge-Key':key,'Content-Type':'application/json'};
 try{
  let ready=false;
  for(let i=0;i<40;i++){if(child.exitCode!==null)break;try{if((await fetch(base+'/health',{headers})).ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready);
  const created=await fetch(base+'/tasks',{method:'POST',headers,body:JSON.stringify({task:'Test large valid stream'})});
  const task=await created.json();
  assert.equal((await fetch(base+'/tasks/'+task.id+'/approve',{method:'POST',headers})).status,202);
  let latest;
  for(let i=0;i<60;i++){
   latest=(await (await fetch(base+'/tasks',{headers})).json()).tasks.find(x=>x.id===task.id);
   if(latest?.status!=='Running')break;
   await delay(100);
  }
  assert.equal(latest.status,'Completed');
  assert.equal(latest.result,'Done');
 }finally{
  child.kill();
  await new Promise(resolve=>mock.close(resolve));
 }
});

test('incomplete AI completion cannot be marked successful',async()=>{
 const key='integration-test-secret-key-at-least-32-characters';
 const mock=createServer(async(req,res)=>{
  for await(const _ of req){}
  res.setHeader('Content-Type','application/x-ndjson');
  res.end(JSON.stringify({type:'complete',result:'Unreviewed answer',trace:[{agent:'Planner',output:'Only a plan'}]})+String.fromCharCode(10));
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 const port=44000+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['index.js'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,AGENTFORGE_API_KEY:key,PORT:String(port),DATABASE_URL:'',AI_SERVICE_URL:'http://127.0.0.1:'+mock.address().port},stdio:'ignore'});
 const base='http://127.0.0.1:'+port+'/api';
 const headers={'X-AgentForge-Key':key,'Content-Type':'application/json'};
 try{
  let ready=false;
  for(let i=0;i<40;i++){if(child.exitCode!==null)break;try{if((await fetch(base+'/health',{headers})).ok){ready=true;break}}catch{}await delay(150)}
  assert.ok(ready);
  const created=await fetch(base+'/tasks',{method:'POST',headers,body:JSON.stringify({task:'Test incomplete result'})});
  const task=await created.json();
  assert.equal((await fetch(base+'/tasks/'+task.id+'/approve',{method:'POST',headers})).status,202);
  let latest;
  for(let i=0;i<50;i++){
   latest=(await (await fetch(base+'/tasks',{headers})).json()).tasks.find(x=>x.id===task.id);
   if(latest?.status==='Failed')break;
   await delay(100);
  }
  assert.equal(latest.status,'Failed');
  assert.match(latest.error,/Invalid AI response/);
 }finally{
  child.kill();
  await new Promise(resolve=>mock.close(resolve));
 }
});
