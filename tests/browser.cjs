/* CI runner for the same harness available manually at /tests/browser.html. */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const T=require('../training.js');
const columns=['Date','Group','Players','Capacity','Places remaining','Session status'];
const countRows=T.catalog.sessions.flatMap(s=>Array.from({length:8},(_,i)=>{
  const players=({wednesday:2,friday:3})[s.id]||0;
  return {c:[T.addDays(T.nextDate(s),7*i),s.id,players,20,20-players,'Planning'].map(v=>({v}))};
}));
const countFixture='/*O_o*/\ngoogle.visualization.Query.setResponse('+JSON.stringify({status:'ok',table:{cols:columns.map(label=>({label})),rows:countRows}})+');';
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch();
    const page=await browser.newPage();
    // CI uses fallback fonts and no external network; form tests cannot send email.
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='127.0.0.1')return route.continue();
      if(url.hostname==='docs.google.com' && url.pathname==='/spreadsheets/d/1xnSKoG20G9P-OcESiUv71IPOSYdEGfU6CLm38xcnSmA/gviz/tq')return route.fulfill({contentType:'application/javascript',body:countFixture,headers:{'Access-Control-Allow-Origin':'*'}});
      return route.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/browser.html`);
    await page.locator('body[data-result]').waitFor({timeout:120000});
    console.log(await page.locator('#status').textContent());
    const failures=await page.locator('.fail').allTextContents();
    if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
  } finally {if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
