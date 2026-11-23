import {sessionTimes,vancouverInstant} from './airtable-roster.mjs';
const open=s=>['Confirmed','Planned'].includes(s['Session status']);
const names=s=>String(s.Coach||'').split(/[,;&/]+/).map(x=>x.trim().toLowerCase()).filter(x=>x&&!['tbd','unassigned','star soccer coaching team'].includes(x));
export function assignmentConflict(session,all){
 const s=session.fields,coaches=names(s);
 if(!open(s)||!coaches.length)return null;
 const range=f=>sessionTimes(f.Time).map(t=>Date.parse(vancouverInstant(f.Date,t)));
 for(const other of all){
  const o=other.fields;
  if(other.id===session.id||o.Date!==s.Date||!open(o)||!names(o).some(c=>coaches.includes(c)))continue;
  try{
   const [start,end]=range(s),[a,b]=range(o);
   if(![start,end,a,b].every(Number.isFinite)||start>=end||a>=b || (start<b && a<end))return other.id;
  }catch{return other.id;}
 }
 return null;
}
