// Install only in an isolated test renderer. RAF is not valid for a hidden window.
async function observeRendererJank(webContents) {
  await webContents.executeJavaScript(`(() => {
    if (window.__meetspaceQaJank) throw Error('Jank observer already installed');
    const samples={startedAt:performance.now(),frames:0,over50ms:0,maxFrameMs:0,longTasks:0,longTaskMs:0,visibility:document.visibilityState};
    let previous=performance.now(),active=true,frameId;
    const frame=now=>{if(!active)return;const delta=now-previous;previous=now;samples.frames++;samples.maxFrameMs=Math.max(samples.maxFrameMs,delta);if(delta>50)samples.over50ms++;frameId=requestAnimationFrame(frame)};
    frameId=requestAnimationFrame(frame);
    let observer;try{observer=new PerformanceObserver(list=>{for(const item of list.getEntries()){samples.longTasks++;samples.longTaskMs+=item.duration}});observer.observe({type:'longtask',buffered:false})}catch{}
    window.__meetspaceQaJank={snapshot:()=>({...samples,elapsedMs:performance.now()-samples.startedAt,visibility:document.visibilityState}),stop:()=>{active=false;cancelAnimationFrame(frameId);observer?.disconnect();return{...samples,elapsedMs:performance.now()-samples.startedAt,visibility:document.visibilityState}}};
  })()`);
  return {
    snapshot:()=>webContents.executeJavaScript('window.__meetspaceQaJank.snapshot()'),
    stop:()=>webContents.executeJavaScript('window.__meetspaceQaJank.stop()'),
  };
}
module.exports={observeRendererJank};
