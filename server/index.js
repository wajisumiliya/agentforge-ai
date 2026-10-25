import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import pg from 'pg';

const app = express();
app.use(helmet());
app.use(cors({origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173'}));
app.use(express.json({limit: '16kb'}));
const db = process.env.DATABASE_URL ? new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='true'?{rejectUnauthorized:true}:undefined}) : null;
const memory = new Map();
const running = new Set();
const failures = new Map();
const maxTrackedIps = 10000;
const authWindowMs = 60000;
const maxFailures = 10;
const maxConcurrentTasks = 2;
const maxPendingTasks = 100;
const maxStreamLineBytes = 1024 * 1024;
const taskIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const apiKey = process.env.AGENTFORGE_API_KEY;
if(!apiKey || apiKey.length < 32) throw new Error('Set AGENTFORGE_API_KEY to a random value of at least 32 characters');
app.use('/api', (req,res,next)=>{
 const ip=req.ip||'local';
 const now=Date.now();
 if(failures.size>=maxTrackedIps){
   for(const [address,entry] of failures){
     if(now-entry.started>=authWindowMs)failures.delete(address);
   }
   if(failures.size>=maxTrackedIps)failures.delete(failures.keys().next().value);
 }
 const record=failures.get(ip);
 if(record && now-record.started>=authWindowMs)failures.delete(ip);
 else if(record && record.count>=maxFailures)return res.status(429).json({error:'Too many invalid authentication attempts'});
 const received=req.get('X-AgentForge-Key')||'';
 const a=Buffer.from(received), b=Buffer.from(apiKey);
 if(a.length!==b.length || !timingSafeEqual(a,b)){
   const current=failures.get(ip);
   const count=(current && now-current.started<authWindowMs?current.count:0)+1;
   failures.set(ip,{count,started:current && now-current.started<authWindowMs?current.started:now});
   return res.status(401).json({error:'Unauthorized'});
 }
 failures.delete(ip);
 next();
});

if(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS agentforge_tasks (
    id UUID PRIMARY KEY, task TEXT NOT NULL, status TEXT NOT NULL,
    result TEXT, trace JSONB, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}
if(db && process.env.AGENTFORGE_SINGLE_INSTANCE==='true') {
  await db.query("UPDATE agentforge_tasks SET status='Failed',error='Interrupted by server restart',updated_at=now() WHERE status='Running'");
}
async function save(t) {
  if(!db){memory.set(t.id,t);return;}
  await db.query(`INSERT INTO agentforge_tasks (id,task,status,result,trace,error) VALUES ($1,$2,$3,$4,$5,$6)
  ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,result=EXCLUDED.result,trace=EXCLUDED.trace,error=EXCLUDED.error,updated_at=now()`,
  [t.id,t.task,t.status,t.result||null,JSON.stringify(t.trace||[]),t.error||null]);
}
async function get(id) {
  if(!taskIdPattern.test(id))return undefined;
  if(!db)return memory.get(id);
  const r=await db.query('SELECT * FROM agentforge_tasks WHERE id=$1',[id]);return r.rows[0];
}
async function list() {
  if(!db)return [...memory.values()].reverse().slice(0,100);
  const r=await db.query('SELECT * FROM agentforge_tasks ORDER BY created_at DESC LIMIT 100');return r.rows;
}
function wrap(fn){return (req,res)=>Promise.resolve(fn(req,res)).catch(e=>{console.error(e);res.status(500).json({error:'Internal server error'});});}
app.get('/api/health',(_,res)=>res.json({status:'ok',persistence:db?'postgresql':'memory'}));
app.get('/api/tasks',wrap(async(_,res)=>res.json({tasks:await list()})));
app.post('/api/tasks',wrap(async(req,res)=>{
  const pending=db
    ? Number((await db.query("SELECT count(*)::int AS n FROM agentforge_tasks WHERE status='Pending approval'")).rows[0].n)
    : [...memory.values()].filter(t=>t.status==='Pending approval').length;
  if(pending>=maxPendingTasks)return res.status(429).json({error:'Pending task queue is full'});
  const task=req.body?.task;
  if(typeof task!=='string'||!task.trim()||task.length>4000)return res.status(400).json({error:'Task must be 1–4000 characters'});
  const t={id:randomUUID(),task:task.trim(),status:'Pending approval',trace:[]};
  await save(t);res.status(201).json(t);
}));
app.post('/api/tasks/:id/reject',wrap(async(req,res)=>{
  const t=await get(req.params.id);if(!t)return res.status(404).json({error:'Not found'});
  if(t.status!=='Pending approval')return res.status(409).json({error:'Task is not pending'});
  if(db){
    const changed=await db.query("UPDATE agentforge_tasks SET status='Rejected',updated_at=now() WHERE id=$1 AND status='Pending approval' RETURNING id",[t.id]);
    if(!changed.rowCount)return res.status(409).json({error:'Task already claimed'});
  }else{
    if(running.has(t.id))return res.status(409).json({error:'Task already claimed'});
    t.status='Rejected';await save(t);
  }
  t.status='Rejected';res.json(t);
}));
async function executeApprovedTask(t){
  try{
    const response=await fetch((process.env.AI_SERVICE_URL||'http://127.0.0.1:8000')+'/run-stream',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({task:t.task}),signal:AbortSignal.timeout(480000)
    });
    if(!response.ok||!response.body)throw new Error('AI service returned '+response.status);
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    let buffer='';
    let completed=false;
    async function consume(line){
      if(!line.trim())return;
      if(Buffer.byteLength(line,'utf8')>maxStreamLineBytes)throw new Error('AI progress event too large');
      const event=JSON.parse(line);
      if(completed)throw new Error('Unexpected AI event after completion');
      if(event.type==='error')throw new Error(event.error||'AI execution failed');
      if(event.type==='progress'){
        if(!Array.isArray(event.trace)||event.trace.length>4||event.trace.some(step=>!step||typeof step.agent!=='string'||typeof step.output!=='string'))throw new Error('Invalid AI progress event');
        t.trace=event.trace;
        if(db)await db.query("UPDATE agentforge_tasks SET trace=$2,updated_at=now() WHERE id=$1 AND status='Running'",[t.id,JSON.stringify(t.trace)]);
        else await save(t);
      }
      if(event.type==='complete'){
        if(typeof event.result!=='string'||!event.result.trim()||!Array.isArray(event.trace)||event.trace.length!==4||event.trace.some(step=>!step||typeof step.agent!=='string'||typeof step.output!=='string'))throw new Error('Invalid AI response');
        t.result=event.result;t.trace=event.trace;completed=true;
      }
    }
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      let index;
      while((index=buffer.indexOf(String.fromCharCode(10)))>=0){
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
        await consume(line);
      }
      if(Buffer.byteLength(buffer,'utf8')>maxStreamLineBytes)throw new Error('AI progress event too large');
    }
    buffer+=decoder.decode();
    if(buffer.trim())await consume(buffer);
    if(!completed)throw new Error('AI stream ended without completion');
    t.status='Completed';
  }catch(e){t.status='Failed';t.error=e instanceof Error?e.message:'Unknown AI error'}
  try{
    if(db)await db.query("UPDATE agentforge_tasks SET status=$2,result=$3,trace=$4,error=$5,updated_at=now() WHERE id=$1 AND status='Running'",[t.id,t.status,t.result||null,JSON.stringify(t.trace||[]),t.error||null]);
    else await save(t);
  }catch(e){console.error('Unable to persist task outcome',e)}
  finally{running.delete(t.id)}
}

app.post('/api/tasks/:id/approve',wrap(async(req,res)=>{
  const t=await get(req.params.id);if(!t)return res.status(404).json({error:'Not found'});
  if(t.status!=='Pending approval')return res.status(409).json({error:'Task is not pending'});
  if(running.size>=maxConcurrentTasks)return res.status(429).json({error:'Local AI concurrency limit reached'});
  if(db){
    const claim=await db.query("UPDATE agentforge_tasks SET status='Running',updated_at=now() WHERE id=$1 AND status='Pending approval' RETURNING id",[t.id]);
    if(!claim.rowCount)return res.status(409).json({error:'Task already claimed'});
  }else{
    if(running.has(t.id))return res.status(409).json({error:'Task already claimed'});
    running.add(t.id);t.status='Running';await save(t);
  }
  running.add(t.id);
  t.status='Running';
  res.status(202).json(t);
  void executeApprovedTask(t);

}));
app.listen(Number(process.env.PORT)||3001,'127.0.0.1',()=>console.log('AgentForge API listening on localhost'));
