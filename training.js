/* One catalog for the schedule, date validation and displayed prices.
 * Browser checks are usability safeguards, NOT server-side price/capacity enforcement.
 * Run node tests/training.test.cjs after changing a session.
 */
(function (root) {
  'use strict';
  const catalog = {
  "zone": "America/Vancouver",
  "currency": "CAD",
  "groupCapacity": 20,
  "email": "starsoccervancouver@gmail.com",
  "coaches": {
    "valentinos": "Valentinos Dinglis",
    "evan": "Evan Lycos",
    "romeo": "Romeo Dinglis",
    "owen": "Owen Soroka"
  },
  "locations": {
    "connaught": {
      "name": "Connaught Park",
      "mapQuery": "Connaught Park Vancouver BC"
    },
    "kits": {
      "name": "Kitsilano Turf",
      "mapQuery": "Kitsilano Secondary School Turf Vancouver BC"
    },
    "fen-burdett": {
      "name": "Fen Burdett Stadium",
      "locality": "North Vancouver",
      "mapQuery": "Fen Burdett Stadium 1648 Jones Avenue North Vancouver"
    }
  },
  "sessions": [
    {
      "id": "tuesday",
      "day": "Tuesday",
      "weekday": 2,
      "time": "9:30–11:00 AM",
      "startMinutes": 570,
      "minAge": null,
      "maxAge": null,
      "ageLabel": "Women’s soccer",
      "audience": "women",
      "location": "fen-burdett",
      "coaches": [
        "valentinos"
      ],
      "dropin": 20,
      "pass4": null,
      "active": true,
      "excludedDates": [],
      "program": "Tuesday adult women's soccer",
      "endMinutes": 660,
      "capacity": 20
    },
    {
      "id": "wednesday",
      "day": "Wednesday",
      "weekday": 3,
      "time": "3:45–5:15 PM",
      "startMinutes": 945,
      "minAge": 9,
      "maxAge": 14,
      "location": "connaught",
      "coaches": [
        "valentinos",
        "romeo"
      ],
      "dropin": 30,
      "pass4": 95,
      "active": true,
      "excludedDates": [],
      "program": "Wednesday weekly training",
      "endMinutes": 1035,
      "capacity": 20
    },
    {
      "id": "thursday",
      "day": "Thursday",
      "weekday": 4,
      "time": "4:30–5:30 PM",
      "startMinutes": 990,
      "minAge": 6,
      "maxAge": 9,
      "location": "connaught",
      "coaches": [
        "valentinos"
      ],
      "dropin": 25,
      "pass4": 80,
      "active": true,
      "excludedDates": [],
      "program": "Thursday weekly training",
      "endMinutes": 1050,
      "capacity": 20
    },
    {
      "id": "friday",
      "day": "Friday",
      "weekday": 5,
      "time": "3:45–5:00 PM",
      "startMinutes": 945,
      "minAge": 6,
      "maxAge": 12,
      "location": "connaught",
      "coaches": [
        "romeo"
      ],
      "dropin": 25,
      "pass4": 80,
      "active": true,
      "excludedDates": [],
      "program": "Friday weekly training",
      "endMinutes": 1020,
      "capacity": 20
    },
    {
      "id": "sunday",
      "day": "Sunday",
      "weekday": 0,
      "time": "9:00–10:30 AM",
      "startMinutes": 540,
      "minAge": 6,
      "maxAge": 9,
      "location": "kits",
      "coaches": [
        "valentinos"
      ],
      "dropin": 30,
      "pass4": 95,
      "active": true,
      "excludedDates": [],
      "program": "Sunday weekly training",
      "endMinutes": 630,
      "capacity": 20
    }
  ],
  "privateRates": {
    "1": {
      "60": 65,
      "90": 97.5,
      "120": 130
    },
    "2": {
      "60": 55,
      "90": 82.5,
      "120": 110
    },
    "3": {
      "60": 45,
      "90": 67.5,
      "120": 90
    },
    "4": {
      "60": 40,
      "90": 60,
      "120": 80
    },
    "5": {
      "60": 35,
      "90": 52.5,
      "120": 70
    },
    "6": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "7": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "8": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "9": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "10": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "11": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "12": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "13": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "14": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "15": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "16": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "17": {
      "60": 30,
      "90": 45,
      "120": 60
    },
    "18": {
      "60": 30,
      "90": 45,
      "120": 60
    }
  },
  "version": "860c9fc3ec76b5d73e21dd4a1c5e5a00966e10ae75a3019e69e42e6ad11f2c79"
};
  function freeze(value) { Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v); }); return Object.freeze(value); }
  freeze(catalog);
  function localClock(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:catalog.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
    return {date:`${parts.year}-${parts.month}-${parts.day}`,minutes:Number(parts.hour)*60+Number(parts.minute)};
  }
  function isoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(value+'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value ? date : null;
  }
  function addDays(value, days) { const d=isoDate(value); if(!d) throw new Error('Choose a valid calendar date.'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
  function getSession(id) { return catalog.sessions.find(s=>s.id===id && s.active) || null; }
  function choice(id, type) {
    const session=getSession(id);
    if (!session || !['dropin','pass4'].includes(type) || !Number.isFinite(session[type]) || session[type]<=0) throw new Error('This booking link is no longer available. Please choose a current session.');
    return {session,type,price:session[type],label:type==='pass4'?'Four-session pass':'Drop-in'};
  }
  function eligibleDate(session, date, now = new Date()) {
    const d=isoDate(date), clock=localClock(now);
    return Boolean(session && session.active && d && d.getUTCDay()===session.weekday && !session.excludedDates.includes(date) && (date>clock.date || (date===clock.date && clock.minutes<session.startMinutes)));
  }
  function nextDate(session, now = new Date()) {
    let date=localClock(now).date;
    for (let i=0;i<366;i++,date=addDays(date,1)) if(eligibleDate(session,date,now)) return date;
    return '';
  }
  function ageDescription(session) { return session.ageLabel || 'Ages '+session.minAge+'–'+session.maxAge; }
  function validAge(session, age) {
    // A supplied age is still needed for preparation. Null catalog bounds mean
    // no published age eligibility gate; 1–120 only validates the entered number.
    return /^\d{1,3}$/.test(String(age)) && Number.isInteger(Number(age)) && Number(age)>=(session.minAge??1) && Number(age)<=(session.maxAge??120);
  }
  function booking(id,type,date,age,now = new Date()) {
    return bookChoice(choice(id,type),date,age,now);
  }
  function bookChoice(result,date,age,now) {
    const {session:s,type}=result;
    if(!eligibleDate(s,date,now)) throw new Error(`Choose an upcoming ${s.day} before the session starts; cancelled dates cannot be booked.`);
    if (!validAge(s,age)) throw new Error(s.minAge===null?'Enter the player’s age as a whole number.':`This session is for ages ${s.minAge}–${s.maxAge}. Please enter a whole-number age in that range.`);
    const dates=[date];
    if(type==='pass4') {
      let candidate=date;
      for(let i=0;dates.length<4 && i<104;i++) {candidate=addDays(candidate,7);if(!s.excludedDates.includes(candidate))dates.push(candidate);}
      if(dates.length!==4) throw new Error('Four scheduled sessions are not available. Please contact the coaching team.');
    }
    return {...result,dates,location:catalog.locations[s.location].name,coaches:s.coaches.map(c=>catalog.coaches[c]).join(' & ')||'Star Soccer coaching team'};
  }
  function prettyDate(value) { return new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(isoDate(value)); }
  function money(value) { return new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:2,minimumFractionDigits:Number.isInteger(value)?0:2}).format(value); }
  function paymentInstructions(playerCount=1) {
    if(!Number.isSafeInteger(playerCount)||playerCount<1)throw new Error('Use the actual number of registered players.');
    return `You can pay by e-transfer to ${catalog.email}, or arrange payment with your coach on the day. Please put your ${playerCount===1?'player’s full name':'players’ full names'} in the transfer notes.`;
  }
  function privateQuote(count,duration) {
    count=Number(count);duration=Number(duration);
    if (!Number.isSafeInteger(count) || count<1 || count>18 || ![60,90,120].includes(duration)) return null;
    const rateCard=catalog.privateRates?.[count];
    const base=rateCard?.[60] ?? (({1:65,2:55,3:45,4:40,5:35})[count] || 30);
    // New standard inquiries use a consistent hourly rate for every duration.
    // Existing agreed bookings keep their recorded charge in the ledger.
    const perPlayer=rateCard?.[duration] ?? base*duration/60;
    return {perPlayer,total:perPlayer*count,base,duration,count,format:count<=5?'private':'smallgroup'};
  }
  function coachId(value) {
    if(Object.hasOwn(catalog.coaches,value)) return value;
    if(value==='Valentino Dinglis') return 'valentinos';
    return Object.keys(catalog.coaches).find(id=>catalog.coaches[id]===value)||'';
  }
  function accepted(response, body) { return Boolean(response.ok && body && (body.success===true || body.success==='true')); }
  const referralSources=Object.freeze({search:'Google Search / Maps',instagram:'Instagram',referral:'Family / friend',community:'School / community',returning:'Returning family',other:'Other'});
  function referralSource(value) { return Object.hasOwn(referralSources,value) ? referralSources[value] : 'Not specified'; }
  function sessionLink(id) {
    if(!getSession(id)) throw new Error('Choose a current session to share.');
    // A fresh canonical URL excludes personal age filters and arbitrary query data.
    return 'https://starsoccer.ca/programs.html?day='+encodeURIComponent(id)+'#sessions';
  }
  function registrationHelp(booking,reference) {
    const body=['Please check whether my registration arrived.',
      'Website reference: '+reference,
      'Training: '+booking.session.day+' · '+booking.session.time,
      'Dates: '+booking.dates.map(prettyDate).join('; '),
      'Location: '+booking.location,
      'Booking: '+booking.label,
      'Quoted total: '+money(booking.price)+' CAD',
      'The website attempt was not confirmed.', '',
      'Parent / guardian name:', 'Player name:'
    ].join('\r\n');
    return 'mailto:'+catalog.email+'?subject='+encodeURIComponent('Please check registration | '+reference)+'&body='+encodeURIComponent(body);
  }
  function receiptText(receipt) {
    return ['Star Soccer booking and payment details',
      'Booking reference: '+receipt.reference,
      'Training: '+receipt.sessionName,
      'Dates: '+receipt.dates.map(prettyDate).join('; '),
      'Location: '+receipt.location,
      'Booking: '+receipt.label,
      'Booking total: '+money(receipt.price)+' CAD',
      '', 'Your place is confirmed by the coaching team.',
      paymentInstructions(),
      'Keep these details before and after training. Contact '+catalog.email+' about payment or session changes.'
    ].join('\n');
  }
  const api=Object.freeze({catalog,localClock,isoDate,addDays,getSession,choice,eligibleDate,nextDate,booking,bookChoice,ageDescription,validAge,prettyDate,money,paymentInstructions,privateQuote,coachId,accepted,receiptText,referralSources,referralSource,sessionLink,registrationHelp});
  root.StarTraining=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
