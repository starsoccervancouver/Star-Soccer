/* A parent-controlled fallback. Never sends email or stores personal details. */
(function(root){
  'use strict';
  const labels={accepted:'Accepted by form service',rejected:'Not submitted',pending:'Not submitted',unconfirmed:'Delivery not confirmed',uncertain:'Delivery not confirmed'};
  function details({requests=[],states=[],reference=''}){
    const lines=['Star Soccer submission follow-up'];
    if(reference)lines.push('Request: '+reference);
    lines.push('Please check this request before creating another registration.','');
    requests.forEach((request,index)=>{
      const state=states[index];
      if(state)lines.push((state.name||'Request')+': '+(labels[state.state]||'Delivery not confirmed'));
      for(const [name,value] of request.entries()){
        if(name.startsWith('_')||!String(value).trim())continue;
        lines.push(name+': '+String(value));
      }
      lines.push('');
    });
    return lines.join('\n');
  }
  function show(container,options){
    const doc=container.ownerDocument,body=details(options);
    const section=doc.createElement('section');section.className='form-recovery-actions';section.setAttribute('aria-label','Send your details another way');
    const explanation=doc.createElement('p');explanation.textContent='Send the details below directly to our team. Opening your email app does not send them automatically.';
    const actions=doc.createElement('div');actions.className='flow-actions';
    const email=doc.createElement('a');email.className='button button-ghost';email.textContent='Email these details';
    const subject=String(options.subject||'Star Soccer submission follow-up').replace(/[\r\n]/g,' ').slice(0,180);
    const address=String(options.email||'').trim();
    if(!/^[^\s<>?&]+@[^\s<>?&]+\.[^\s<>?&]+$/.test(address))throw new Error('A valid team email is required.');
    const mailto='mailto:'+address+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
    // Long mailto URLs are truncated by some email clients. Keep a complete copy visible.
    const longMessage=mailto.length>1800;
    email.href=longMessage?'mailto:'+address+'?subject='+encodeURIComponent(subject):mailto;
    if(longMessage){email.textContent='Open email';explanation.textContent='Copy the details below, then open your email app and paste them into a message to '+address+'. Your email app chooses the sending account; the contact email you entered is included below.';}
    const copy=doc.createElement('button');copy.type='button';copy.className='button button-ghost';copy.textContent='Copy details';
    const download=doc.createElement('button');download.type='button';download.className='button button-ghost';download.textContent='Save a copy';
    const review=doc.createElement('details');review.className='quick-details';
    const summary=doc.createElement('summary');summary.textContent='Review your submitted details';
    const field=doc.createElement('textarea');field.readOnly=true;field.rows=7;field.value=body;field.setAttribute('aria-label','Complete submission details');
    const note=doc.createElement('p');note.setAttribute('role','status');note.className='form-recovery-copy-status';
    copy.addEventListener('click',async()=>{
      try{if(!root.navigator?.clipboard?.writeText)throw new Error('Clipboard unavailable');await root.navigator.clipboard.writeText(body);note.textContent='Copied. Paste these details into your email to '+address+'.';}
      catch{review.open=true;field.focus();field.select();note.textContent='Your details are selected. Use your device’s Copy action, then paste them into your email.';}
    });
    download.addEventListener('click',()=>{
      const url=root.URL.createObjectURL(new Blob([body],{type:'text/plain;charset=utf-8'}));
      const link=doc.createElement('a');link.href=url;link.download='star-soccer-'+String(options.reference||'request').replace(/[^a-z0-9-]/gi,'').slice(0,70)+'.txt';
      doc.body.append(link);link.click();link.remove();root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);
    });
    review.append(summary,field);actions.append(email,copy,download);section.append(explanation,actions,review,note);container.append(section);container.hidden=false;
    return section;
  }
  const api=Object.freeze({details,show});root.StarFormRecovery=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
