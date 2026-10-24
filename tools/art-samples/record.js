if(new URLSearchParams(location.search).get('profile')==='1'){
const start=document.createElement('button'),stop=document.createElement('button'),a=document.createElement('a');start.textContent='开始录制画布';stop.textContent='结束录制';stop.disabled=true;
const bar=document.createElement('div');bar.style.cssText='position:fixed;left:8px;bottom:1px;z-index:9999;background:#111;color:white;font:12px sans-serif';bar.append(start,stop,a);document.body.append(bar);let rec,parts=[];
start.onclick=()=>{parts=[];const c=document.querySelector('canvas');rec=new MediaRecorder(c.captureStream(30),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:4000000});rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};rec.onstop=()=>{a.href=URL.createObjectURL(new Blob(parts,{type:'video/webm'}));a.download='tianxu-art-battle.webm';a.textContent='下载真实画布录像';start.disabled=false;};rec.start();start.disabled=true;stop.disabled=false;};stop.onclick=()=>{rec.stop();stop.disabled=true;};
}
