// Local QA instrumentation only. Never included in release staging/packages.
if(['127.0.0.1','localhost','[::1]'].includes(location.hostname)&&new URLSearchParams(location.search).get('profile')==='1'){
 const requests=[],remote=[],mounts=[],clicks=[],longTasks=[];let httpPending=0,imagePending=0,cc,signature='',stable=0,seq=0,pending,createMs=0,created=0;
 const started=performance.now(),out=document.createElement('output');out.hidden=true;out.id='player-profile';document.body.append(out);
 const originalFetch=window.fetch;
 window.fetch=async function(...args){const at=performance.now(),url=new URL(typeof args[0]==='string'?args[0]:args[0].url,location.href),record={path:url.pathname,start:at};httpPending++;
  try{const response=await originalFetch.apply(this,args);record.headersMs=performance.now()-at;record.status=response.status;const originalJson=response.json.bind(response);
   response.json=async()=>{httpPending++;try{const begin=performance.now(),text=await response.text();record.bodyReadDecodeMs=performance.now()-begin;const parse=performance.now(),value=JSON.parse(text);record.parseMs=performance.now()-parse;record.textChars=text.length;return value;}finally{httpPending--;}};
   requests.push(record);return response;
  }finally{httpPending--;}
 };
 try{new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push({start:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
 document.addEventListener('mousedown',e=>{pending={seq:++seq,x:Math.round(e.clientX),y:Math.round(e.clientY),at:performance.now(),previous:signature,firstUiMs:null,readyMs:null,startCreated:created,startCreateMs:createMs};clicks.push(pending);},{capture:true,passive:true});
 const resource=r=>({path:new URL(r.name).pathname,start:r.startTime,ttfbMs:r.responseStart-r.requestStart,transferMs:r.responseEnd-r.responseStart,totalMs:r.duration,transferBytes:r.transferSize,decodedBytes:r.decodedBodySize});
 const publish=()=>{const s=window.__TIANXU_UI__?.snapshot?.();out.setAttribute('data-json',JSON.stringify({elapsed:performance.now()-started,page:s?.page,busy:s?.busy,httpPending,imagePending,requests,remote,mounts,clicks:clicks.map(({at,previous,startCreated,startCreateMs,...v})=>v),longTasks,created,createMs,resources:performance.getEntriesByType('resource').map(resource),engine:window.__TIANXU_UI__?.performance?.(),art:window.__TIANXU_UI__?.art?.()}));};
 const afterDraw=()=>{const s=window.__TIANXU_UI__?.snapshot?.(),scene=cc.director.getScene(),names=[];let nodes=0;const walk=n=>{if(!n.activeInHierarchy)return;nodes++;if(/^(HomeWnd:original|PlayerWindow:|CardDeckWindow|GrowthWindows|OriginalWorldMapWindow|BattleScene:source-layers)/.test(n.name))names.push(n.name+':'+n.uuid);for(const c of n.children)walk(c);};if(pending&&scene)walk(scene);
  const next=s?.page+':'+names.join('|');if(next===signature)stable++;else stable=0;signature=next;
  if(pending){if(pending.firstUiMs===null&&pending.previous!==next&&names.length)pending.firstUiMs=performance.now()-pending.at;
   if(pending.firstUiMs!==null&&pending.readyMs===null&&!s?.busy&&!httpPending&&!imagePending&&stable>=2){pending.readyMs=performance.now()-pending.at;pending.createdNodes=created-pending.startCreated;pending.createCpuMs=createMs-pending.startCreateMs;pending.nodes=nodes;}}
 };
 const install=async()=>{if(!globalThis.System)return setTimeout(install,20);cc=await System.import('cc');const load=cc.assetManager.loadRemote;
  cc.assetManager.loadRemote=function(url,options,callback){if(typeof callback!=='function')return load.apply(this,arguments);const at=performance.now();imagePending++;return load.call(this,url,options,(...args)=>{imagePending--;remote.push({path:new URL(url,location.href).pathname,start:at,readyMs:performance.now()-at,failed:!!args[0]});callback(...args);});};
  cc.director.on(cc.Director.EVENT_AFTER_DRAW,afterDraw);
  const instrument=async()=>{if(!window.__TIANXU_UI__)return setTimeout(instrument,50);try{const {OriginalUi}=await System.import('chunks:///_virtual/OriginalUi.ts'),{CocosUi}=await System.import('chunks:///_virtual/CocosUi.ts');
   for(const [proto,key]of [[OriginalUi.prototype,'createNode'],[CocosUi.prototype,'node']]){const fn=proto[key];proto[key]=function(...args){const at=performance.now();try{return fn.apply(this,args);}finally{createMs+=performance.now()-at;created++;}};}
   const mount=OriginalUi.prototype.mount;OriginalUi.prototype.mount=async function(key,...args){const at=performance.now(),before=created,cpu=createMs;try{return await mount.call(this,key,...args);}finally{mounts.push({component:key,start:at,totalMs:performance.now()-at,createdNodes:created-before,createCpuMs:createMs-cpu});}};
  }catch{setTimeout(instrument,100);}};void instrument();
 };void install();setInterval(publish,200);
}
