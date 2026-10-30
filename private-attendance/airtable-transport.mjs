/* One shared queue per coordinator keeps roster reads and projections below 5 requests/sec. */
export function createAirtableTransport({fetchFn=fetch,intervalMs=250}={}){
 let last=0,tail=Promise.resolve();
 return (url,options)=>{const task=tail.catch(()=>{}).then(async()=>{const pause=intervalMs-(Date.now()-last);if(pause>0)await new Promise(r=>setTimeout(r,pause));last=Date.now();return fetchFn(url,options);});tail=task.then(()=>{},()=>{});return task;};
}
