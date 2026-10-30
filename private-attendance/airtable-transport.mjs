/* One shared queue per coordinator keeps roster reads and projections below 5 requests/sec. */
export function createAirtableTransport({fetchFn=fetch,intervalMs=250,maxReadRetries=2,maxRetryWaitMs=5000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=()=>Date.now()}={}){
 let last=0,tail=Promise.resolve();
 return (url,options={})=>{const task=tail.catch(()=>{}).then(async()=>{
  // Keep every attempt in the same queue. Never replay a possibly committed write.
  const readonly=(options.method||'GET').toUpperCase()==='GET';let waited=0;
  for(let attempt=0;;attempt++){
   options.signal?.throwIfAborted();const pause=intervalMs-(clock()-last);if(pause>0)await sleep(pause);options.signal?.throwIfAborted();last=clock();
   let response,failure;try{response=await fetchFn(url,options);}catch(error){failure=error;}
   const retry=readonly&&attempt<maxReadRetries&&!options.signal?.aborted&&(failure||[429,500,502,503,504].includes(response?.status));
   if(!retry){if(failure)throw failure;return response;}
   const hint=response?.headers?.get('retry-after'),seconds=hint&&/^\d+(?:\.\d+)?$/.test(hint)?Number(hint)*1000:NaN,date=hint?Date.parse(hint):NaN;
   const requested=Number.isFinite(seconds)?seconds:Number.isFinite(date)?Math.max(0,date-clock()):0,delay=Math.max(500*2**attempt,requested);
   // A long Retry-After is returned to the caller instead of sleeping past our budget.
   if(waited+delay>maxRetryWaitMs){if(failure)throw failure;return response;}
   await response?.body?.cancel();waited+=delay;await sleep(delay);
  }
 });tail=task.then(()=>{},()=>{});return task;};
}
