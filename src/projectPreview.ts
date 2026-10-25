export type GeneratedFile = {name:string;content:string};
export function extractProject(text:string):GeneratedFile[]{
 const files:GeneratedFile[]=[];
 const regex=/```([^\n]*)\n([\s\S]*?)```/g;
 for(const match of text.matchAll(regex)){
  const hint=match[1].trim().toLowerCase();
  const name=hint.includes('html')?'index.html':hint.includes('css')?'styles.css':hint.includes('javascript')||hint==='js'?'script.js':'';
  if(name&&!files.some(f=>f.name===name))files.push({name,content:match[2].trim()});
 }
 if(!files.some(f=>f.name==='index.html')){
  const start=text.toLowerCase().indexOf('<!doctype html');
  const alt=text.toLowerCase().indexOf('<html');
  const pos=start>=0?start:alt;
  if(pos>=0){const tail=text.slice(pos);const closing=tail.toLowerCase().indexOf('</html>');if(closing>=0)files.unshift({name:'index.html',content:tail.slice(0,closing+7)});}
 }
 return files;
}
export function previewHtml(files:GeneratedFile[]):string|null{
 const html=files.find(f=>f.name==='index.html');if(!html)return null;
 const css=files.find(f=>f.name==='styles.css')?.content||'';
 return '<style>'+css+'</style>'+html.content;
}

function crc32(bytes:Uint8Array):number{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
export function makeZip(files:GeneratedFile[]):Blob{
 const enc=new TextEncoder();const local:Uint8Array[]=[];const central:Uint8Array[]=[];let offset=0;
 for(const file of files){
  const name=enc.encode(file.name),data=enc.encode(file.content),crc=crc32(data);
  const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,2048,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);header.set(name,30);
  local.push(header,data);
  const entry=new Uint8Array(46+name.length),e=new DataView(entry.buffer);
  e.setUint32(0,0x02014b50,true);e.setUint16(4,20,true);e.setUint16(6,20,true);e.setUint16(8,2048,true);e.setUint32(16,crc,true);e.setUint32(20,data.length,true);e.setUint32(24,data.length,true);e.setUint16(28,name.length,true);e.setUint32(42,offset,true);entry.set(name,46);central.push(entry);
  offset+=header.length+data.length;
 }
 const directorySize=central.reduce((sum,part)=>sum+part.length,0);
 const end=new Uint8Array(22),view=new DataView(end.buffer);
 view.setUint32(0,0x06054b50,true);view.setUint16(8,files.length,true);view.setUint16(10,files.length,true);view.setUint32(12,directorySize,true);view.setUint32(16,offset,true);
 return new Blob([...local,...central,end] as BlobPart[],{type:'application/zip'});
}
export function downloadProject(files:GeneratedFile[],id:string):void{
 const url=URL.createObjectURL(makeZip(files));const a=document.createElement('a');a.href=url;a.download='agentforge-'+id.slice(0,8)+'.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
