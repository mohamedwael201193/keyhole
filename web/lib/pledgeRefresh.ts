/** Cancel the wait too: a misbehaving transport cannot publish after its deadline. */
export function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T> {
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason??Error("Chain refresh timed out"));
  // Observe transport rejections even when the deadline was already reached.
  work.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
  if(signal.aborted){abort();return;}
  signal.addEventListener("abort",abort,{once:true});
 });
}
/** Manual refreshes coalesce with polling; no poll ever supersedes a healthy in-flight read. */
export function createSingleFlightRefresh(timeoutMs=15000) {
 let flight:Promise<void>|null=null;
 return {run(task:(signal:AbortSignal)=>Promise<void>):Promise<void>{
  if(flight)return flight;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(Error("Chain refresh timed out; retry after backoff.")),timeoutMs);
  flight=Promise.resolve().then(()=>task(controller.signal)).finally(()=>{clearTimeout(timer);controller.abort(Error("Refresh finished"));flight=null;});
  return flight;
 }};
}
/** Schedule from completion, with bounded error backoff, not a fixed overlapping interval. */
export function startPledgePolling(refresh:()=>Promise<void>,visible:()=>boolean,baseMs=4000,maxMs=30000) {
 let stopped=false,delay=baseMs,timer:ReturnType<typeof setTimeout>|undefined;
 const tick=async()=>{
  if(stopped)return;
  if(visible()){try{await refresh();delay=baseMs;}catch{delay=Math.min(maxMs,delay*2);}}
  if(!stopped)timer=setTimeout(()=>void tick(),delay);
 };
 void tick();
 return ()=>{stopped=true;if(timer)clearTimeout(timer);};
}
