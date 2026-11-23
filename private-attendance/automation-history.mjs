const columns = {
  intake: ['Message ID','Sender','Subject','Received date','Kind','Review'],
  registrations: ['Booking','Source Gmail ID','Received at','Parent email','Reference','Status','Confirmation Gmail ID'],
  bookings: ['Booking reference','Booking status'],
  payments: ['Evidence reference','Payment reference','Amount CAD','Verification','Payment date','Booking'],
  allocations: ['Booking','Payment','Review status'],
  draftLog: ['Email key','Email kind','Gmail draft ID','Sent Gmail ID','Status','Review detail','Recipient']
};

export async function searchAutomationHistory(ledger, query) {
  const term = String(query || '').trim().toLowerCase();
  if (term.length < 3 || term.length > 200) throw Error('Invalid history search');
  const data = {};
  for (const [table, fields] of Object.entries(columns)) data[table] = await ledger.list(table, fields);
  const messages = new Map(data.intake.map(r => [r.fields['Message ID'], r]));
  const bookings = new Map(data.bookings.map(r => [r.id, r.fields]));
  const usedMail = new Set(), usedLogs = new Set(), results = [];
  function entry(title, records, lines, ids, logs, extra = []) {
    const links = [];
    for (const id of new Set(ids.filter(Boolean))) {
      usedMail.add(id);
      const m = messages.get(id)?.fields;
      if (m) {
        records.push(m.Sender, m.Subject);
        lines.push('Gmail received · ' + (m['Received date'] || 'Date unavailable') + ' · ' + m.Subject);
        lines.push('Airtable intake · ' + [m.Kind,m.Review].filter(Boolean).join(' · '));
      }
      links.push({id,label:'Original email'});
    }
    for (const log of logs) {
      usedLogs.add(log.id);
      const f = log.fields;
      records.push(f.Recipient,f['Email key'],f['Gmail draft ID']);
      lines.push([f['Email kind'],f.Status,f.Recipient,f['Review detail'] === '—' ? '' : f['Review detail']].filter(Boolean).join(' · '));
      if (f['Gmail draft ID']) lines.push('Recorded Gmail draft ID · ' + f['Gmail draft ID']);
      if (f['Sent Gmail ID']) links.push({id:f['Sent Gmail ID'],label:'Sent email'});
    }
    links.push(...extra);
    if (!logs.length && !extra.length) lines.push('No linked draft or send record found.');
    if ([title,...records,...lines,...links.map(l=>l.id)].some(v=>String(v||'').toLowerCase().includes(term))) {
      results.push({title,lines,links:links.filter(l=>/^[0-9a-f]{12,32}$/i.test(l.id))});
    }
  }
  function related(kind,id) { return data.draftLog.filter(r=>r.fields['Email key']===kind+':'+id); }
  for (const r of data.payments) {
    const f=r.fields;
    const ids=Array.from(String(f['Evidence reference']||'').matchAll(/\bGmail ([0-9a-f]{12,32})\b/gi),m=>m[1]);
    const linked=new Set([...(f.Booking||[]),...data.allocations.filter(a=>a.fields.Payment?.includes(r.id)).flatMap(a=>a.fields.Booking||[])]);
    const refs=[...linked].map(id=>bookings.get(id)?.['Booking reference']||id);
    const recipients=data.registrations.filter(x=>x.fields.Booking?.some(id=>linked.has(id))).map(x=>x.fields['Parent email']);
    entry('Payment · '+(f['Payment reference']||r.id),[r.id,...linked,...recipients],[['Airtable payment',f['Payment date'],f.Verification,f['Amount CAD']!=null?'CAD '+f['Amount CAD']:'Amount unavailable'].filter(Boolean).join(' · '),...refs],ids,related('Receipt',r.id));
  }
  for (const r of data.bookings) {
    const regs=data.registrations.filter(x=>x.fields.Booking?.includes(r.id));
    entry('Booking · '+(r.fields['Booking reference']||r.id),[r.id,...regs.map(x=>x.fields['Parent email'])],
      ['Airtable booking · '+(r.fields['Booking status']||'Status unavailable'),...regs.map(x=>['Registration',x.fields.Reference,x.fields.Status,x.fields['Received at']].filter(Boolean).join(' · '))],
      regs.map(x=>x.fields['Source Gmail ID']),related('Confirmation',r.id),regs.filter(x=>x.fields['Confirmation Gmail ID']).map(x=>({label:'Recorded confirmation',id:x.fields['Confirmation Gmail ID']})));
  }
  for(const r of data.registrations.filter(x=>!x.fields.Booking?.length)) entry('Registration · '+(r.fields.Reference||r.id),[r.fields['Parent email']],['Airtable registration · '+(r.fields.Status||'Status unavailable'),'No linked booking.'],[r.fields['Source Gmail ID']],[]);
  for(const r of data.intake) if(!usedMail.has(r.fields['Message ID'])) entry('Email · '+(r.fields.Subject||r.id),[r.id],[],[r.fields['Message ID']],[]);
  for(const r of data.draftLog) if(!usedLogs.has(r.id)) entry(r.fields['Email kind']||'Email automation',[r.id],[],[],[r]);
  return {total:results.length,results:results.slice(0,50)};
}
