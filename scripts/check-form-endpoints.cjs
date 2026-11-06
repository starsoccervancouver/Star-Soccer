/* Publishing must wait for the owner's real, verified Formspree endpoint. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const pages=['contact.html','program-private-small-group.html','registration.html','christmas-camp-registration.html','boxing-camp-registration.html'];
const endpoints=pages.map(file=>{
  const html=fs.readFileSync(path.join(root,file),'utf8');
  const action=html.match(/<form\b[^>]*\baction="([^"]*)"/i)?.[1];
  if(!/^https:\/\/formspree\.io\/f\/[a-z0-9]+$/i.test(action||'')||/\/(testform|fixture|example|yourformid)$/i.test(action))throw new Error(file+': add the verified Star Soccer Formspree endpoint before publishing.');
  if(!html.includes('form-service.js')||!html.includes('form-recovery.js'))throw new Error(file+': missing submission/recovery script.');
  return action;
});
if(new Set(endpoints).size!==1)throw new Error('All Star Soccer forms must use the approved business inbox endpoint.');
console.log('Five forms use the same configured Formspree endpoint.');
