import {appendFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
export function runtimeLogger(folder){
 if(folder)mkdirSync(folder,{recursive:true});let failed=false;
 return(level,event,fields={})=>{const row={at:new Date().toISOString(),level,event,...fields},text=JSON.stringify(row);
  try{if(folder)appendFileSync(path.join(folder,row.at.slice(0,10)+'.ndjson'),text+'\n',{mode:0o600});else if(level==='error')console.error(text);}
  catch(e){if(!failed){failed=true;console.error('运行日志写入失败：'+e.message);}if(level==='error')console.error(text);}
 };
}
