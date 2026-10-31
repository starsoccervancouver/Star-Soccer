/* One request per player preserves the existing intake contract. No player data is stored. */
(function(root){
  'use strict';
  const states=new Set(['pending','accepted','rejected','unconfirmed']);
  function reference(prefix='SS-'){
    const suffix=root.crypto?.randomUUID?root.crypto.randomUUID().toUpperCase():Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,10).toUpperCase();
    return prefix+suffix.slice(0,43-prefix.length);
  }
  function mount(form,{minAge,maxAge,nameLabel='Child’s name',experience=false,onChange=()=>{}}={}){
    const doc=form.ownerDocument,records=[],savedDisabled=new Map();let locked=false,serial=1;
    const primary={key:'player-1',state:'pending',reference:'',name:form.elements.namedItem('Player name'),age:form.elements.namedItem('Player age'),experience:form.elements.namedItem('Experience'),notes:form.elements.namedItem('Notes')};
    if(!primary.name||!primary.age)throw new Error('Player fields are required.');
    records.push(primary);
    form.addEventListener('input',event=>{if(records.some(p=>p.name===event.target))records.forEach(p=>p.name.setCustomValidity(''));});
    const section=doc.createElement('div');section.className='family-players';section.setAttribute('aria-label','Additional players');
    const add=doc.createElement('button');add.type='button';add.className='button button-ghost family-add-player';add.textContent='Add another player';
    const help=doc.createElement('p');help.className='family-help';help.textContent='Players share this session or package. Each player’s place is confirmed separately.';
    const anchor=form.querySelector('[data-optional-fields]')||form.querySelector('[type="submit"]');
    anchor.before(section,add,help);
    function input(labelText,type,key,id){
      const label=doc.createElement('label');label.textContent=labelText;
      const el=doc.createElement(type==='textarea'?'textarea':'input');
      if(type!=='textarea')el.type=type;else {el.rows=2;el.maxLength=1000;}
      el.id=id;el.dataset.playerField=key;
      if(type==='text'){el.maxLength=100;el.autocomplete='off';el.required=true;}
      if(type==='number'){el.min=minAge;el.max=maxAge;el.step='1';el.inputMode='numeric';el.required=true;el.setAttribute('data-native-number','');}
      label.append(el);return {label,el};
    }
    add.addEventListener('click',()=>{
      if(locked)return;
      const index=++serial,key='player-'+index,fieldset=doc.createElement('fieldset');fieldset.className='family-player';
      const legend=doc.createElement('legend');legend.textContent='Additional player';fieldset.append(legend);
      const row=doc.createElement('div');row.className='quick-player-row';
      const name=input(nameLabel,'text','name',key+'-name'),age=input('Age','number','age',key+'-age');row.append(name.label,age.label);fieldset.append(row);
      let exp=null;
      if(experience){const label=doc.createElement('label');label.textContent='Soccer experience';exp=primary.experience.cloneNode(true);exp.removeAttribute('name');exp.id=key+'-experience';exp.value='';label.append(exp);fieldset.append(label);}
      const notes=input('Note for this player (optional)','textarea','notes',key+'-notes');fieldset.append(notes.label);
      const remove=doc.createElement('button');remove.type='button';remove.className='flow-text-link family-remove-player';remove.textContent='Remove player';fieldset.append(remove);
      const record={key,state:'pending',reference:'',name:name.el,age:age.el,experience:exp,notes:notes.el,fieldset};records.push(record);section.append(fieldset);
      remove.addEventListener('click',()=>{
        if(locked)return;
        records.splice(records.indexOf(record),1);fieldset.remove();
        // Removing a duplicate must allow native validation to reach validate() again.
        records.forEach(p=>p.name.setCustomValidity(''));
        onChange();add.focus();
      });
      fieldset.addEventListener('input',()=>{for(const p of records)p.name.setCustomValidity('');});
      onChange();name.el.focus();
    });
    function players(){return records.map(p=>({key:p.key,name:p.name.value.trim(),age:p.age.value,experience:p.experience?.value||'',notes:p.notes?.value.trim()||'',state:p.state,reference:p.reference}));}
    function validate(){
      const seen=new Set();
      for(const p of records){
        p.name.setCustomValidity('');const name=p.name.value.trim(),key=name.normalize('NFC').toLocaleLowerCase();
        if(!name||/[\r\n\x00-\x1f]/.test(name))p.name.setCustomValidity(nameLabel==='Child’s name'?'Enter the child’s name.':'Enter the player’s name.');
        else if(seen.has(key))p.name.setCustomValidity('Use each player’s full name so the coaching team can tell them apart.');
        seen.add(key);
      }
      return form.reportValidity();
    }
    function lock(){
      if(locked)return;locked=true;
      [...form.elements].filter(el=>el.type!=='submit').forEach(el=>{savedDisabled.set(el,el.disabled);el.disabled=true;});
    }
    function unlock(){
      if(records.some(p=>['accepted','unconfirmed'].includes(p.state)))return false;
      savedDisabled.forEach((value,el)=>{el.disabled=value;});savedDisabled.clear();locked=false;return true;
    }
    return {players,count:()=>records.length,validate,lock,unlock,
      setState(key,state){const p=records.find(p=>p.key===key);if(!p||!states.has(state))throw new Error('Invalid player status.');p.state=state;},
      reference(key,prefix='SS-'){const p=records.find(p=>p.key===key);if(!p)throw new Error('Unknown player.');return p.reference||(p.reference=reference(prefix));}
    };
  }
  const api=Object.freeze({mount,reference});root.StarFamilyRegistration=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
