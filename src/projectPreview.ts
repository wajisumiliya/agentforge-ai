export type GeneratedFile = {name:string;content:string};
export function extractProject(text:string):GeneratedFile[]{
 const files:GeneratedFile[]=[];
 const regex=/```([^\n]*)\n([\s\S]*?)```/g;
 for(const match of text.matchAll(regex)){
  const hint=match[1].trim().toLowerCase();
  const name=hint.includes('html')?'index.html':hint.includes('css')?'styles.css':hint.includes('javascript')||hint==='js'?'script.js':'';
  if(name&&!files.some(f=>f.name===name))files.push({name,content:match[2].trim()});
 }
 return files;
}
export function previewHtml(files:GeneratedFile[]):string|null{
 const html=files.find(f=>f.name==='index.html');if(!html)return null;
 const css=files.find(f=>f.name==='styles.css')?.content||'';
 return '<style>'+css+'</style>'+html.content;
}
