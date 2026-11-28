import {deny} from './coach-store.mjs';
import {sessionRate, sessionRateCutover} from './session-rate.mjs';

const recordId = /^rec[A-Za-z0-9]{14}$/;
const commandId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const links = value => Array.isArray(value) ? value : [];
const one = (value, id) => links(value).length === 1 && value[0] === id;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const names = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const coveredDates = booking => (String(booking['Covered dates'] || booking['Start date'] || '').match(/\d{4}-\d{2}-\d{2}/g) || []);
const fields = {
  sessions:['Session','Date','Time','Venue','Session status','Weekly program'],
  players:['Player','Player status','Family','Source player ID'],
  families:['Family','Guardian name'],
  programs:['Program','Drop-in CAD'],
  attendance:['Player','Session','Booking','Coverage state','Source coverage key','Attendance status'],
  bookings:['Player','Family','Booking type','Booking status','Start date','Covered dates','First session','Fixed-price package','Source booking ID'],
  enrollments:['Enrollment','Player','Family','Weekly program','Enrollment status','Effective from','Effective until','Billing schedule','Billing approval','Agreed per-session CAD','Prepaid covered from','Prepaid covered until']
};

export function createSessionRoster({db, store, today, sessionRateField=null}) {
  const readColumns = table => table === 'sessions' && sessionRateField ? [...fields.sessions,sessionRateField] : fields[table];
  const usesSessionRate = session => !!sessionRateField && session.fields.Date >= sessionRateCutover;
  const rateFor = (data, session) => {
    const program = data.programs?.find(row => row.id === programFor(session))?.fields;
    const rate = sessionRate(session.fields,program,sessionRateField);
    return rate === null ? null : Math.round(rate * 100);
  };
  store.run(`CREATE TABLE IF NOT EXISTS coach_roster_commands (
    id TEXT PRIMARY KEY, actor TEXT NOT NULL, payload TEXT NOT NULL, player_id TEXT, result TEXT
  )`);
  store.run(`CREATE TABLE IF NOT EXISTS coach_roster_memberships (
    player_id TEXT NOT NULL, program_id TEXT NOT NULL, enrollment_id TEXT NOT NULL,
    start_date TEXT NOT NULL, rate_cents INTEGER NOT NULL, independent INTEGER NOT NULL DEFAULT 0,
    follow_rate INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(player_id, program_id)
  )`);

  async function snapshot() {
    const entries = await Promise.all(Object.keys(fields).map(async table => [table, await db.list(table, readColumns(table))]));
    return Object.fromEntries(entries);
  }
  function sessionFor(data, id) {
    const session = data.sessions.find(row => row.id === id);
    if (!session || !date(session.fields.Date) || !['Planned','Confirmed','Completed'].includes(session.fields['Session status'])) deny('ROSTER_SESSION_UNAVAILABLE', 409);
    return session;
  }
  function playerFor(data, id) {
    const player = data.players.find(row => row.id === id);
    if (!player || !names(player.fields.Player) || player.fields['Player status'] === 'Inactive') deny('ROSTER_PLAYER_UNAVAILABLE', 409);
    if (links(player.fields.Family).length > 1) deny('ROSTER_FAMILY_CONFLICT', 409);
    return player;
  }
  function programFor(session) {
    const programs = links(session.fields['Weekly program']);
    return programs.length === 1 && recordId.test(programs[0]) ? programs[0] : null;
  }
  function existingSeat(data, sessionId, playerId) {
    const seats = data.attendance.filter(row => links(row.fields.Session).includes(sessionId) && links(row.fields.Player).includes(playerId));
    if (seats.length > 1 || seats.some(row => !one(row.fields.Session, sessionId) || !one(row.fields.Player, playerId))) deny('ROSTER_CONFLICT', 409);
    return seats[0];
  }
  function existingBooking(data, session, player) {
    const ambiguousPass=data.bookings.some(({fields:booking}) =>
      links(booking.Player).includes(player.id)&&['Accepted','Completed'].includes(booking['Booking status'])&&
      (booking['Booking type']==='Four consecutive sessions'||booking['Fixed-price package']===true)&&
      date(booking['Start date'])&&booking['Start date']<=session.fields.Date&&!booking['Covered dates']);
    if(ambiguousPass)deny('ROSTER_BOOKING_CONFLICT',409);
    const matches = data.bookings.filter(({fields:booking}) => links(booking.Player).includes(player.id) &&
      ['Accepted','Completed'].includes(booking['Booking status']) && coveredDates(booking).includes(session.fields.Date));
    if (matches.length > 1) deny('ROSTER_BOOKING_CONFLICT', 409);
    if (!matches.length) return null;
    const match = matches[0], booking = match.fields, playerFamily = links(player.fields.Family), bookingFamily = links(booking.Family);
    const packageBooking = booking['Fixed-price package'] === true || booking['Booking type'] === 'Four consecutive sessions';
    if (!one(booking.Player, player.id) || playerFamily.length > 1 || bookingFamily.length > 1 ||
        bookingFamily.length && (!playerFamily.length || bookingFamily[0] !== playerFamily[0]) ||
        !packageBooking && links(booking['First session']).length && !one(booking['First session'], session.id)) deny('ROSTER_BOOKING_CONFLICT', 409);
    return match;
  }
  function prepaidEnrollment(data, session, player) {
    const programId=programFor(session);
    const passes=data.enrollments.filter(({fields:item}) => links(item.Player).includes(player.id) &&
      links(item['Weekly program']).includes(programId) && item['Enrollment status']==='Active' &&
      item['Billing schedule']==='Four-session prepaid' &&
      (!item['Effective from'] || item['Effective from']<=session.fields.Date) &&
      (!item['Effective until'] || item['Effective until']>=session.fields.Date));
    if(passes.some(({fields:item})=>!one(item.Player,player.id)||!one(item['Weekly program'],programId)||
      item['Billing approval']!=='Approved'||!date(item['Prepaid covered from'])||!date(item['Prepaid covered until'])||
      links(item.Family).length>1||links(item.Family).length&&!one(player.fields.Family,item.Family[0]))) deny('ROSTER_ENROLLMENT_CONFLICT',409);
    const covered=passes.filter(({fields:item})=>item['Prepaid covered from']<=session.fields.Date&&item['Prepaid covered until']>=session.fields.Date);
    if(covered.length>1)deny('ROSTER_ENROLLMENT_CONFLICT',409);
    return covered[0]||null;
  }
  function checkRates(data, session, player) {
    const programId=programFor(session);
    if(!programId)return;
    const amounts=data.enrollments.filter(({fields:item})=>one(item.Player,player.id)&&one(item['Weekly program'],programId)&&
      item['Enrollment status']==='Active'&&item['Billing schedule']==='Per session'&&item['Billing approval']==='Approved'&&
      (!item['Effective from']||item['Effective from']<=session.fields.Date)&&(!item['Effective until']||item['Effective until']>=session.fields.Date)&&
      Number.isFinite(item['Agreed per-session CAD'])&&item['Agreed per-session CAD']>=0)
      .map(({fields:item})=>Math.round(item['Agreed per-session CAD']*100));
    if(new Set(amounts).size>1)deny('ROSTER_ENROLLMENT_CONFLICT',409);
  }
  async function seat(data, session, player, rateCents, ignoreVoid=false) {
    const prior = existingSeat(data, session.id, player.id);
    if (prior) {
      if(prior.fields['Coverage state']==='Active'||ignoreVoid&&prior.fields['Coverage state']==='Void')return false;
      deny('ROSTER_CONFLICT',409);
    }
    let booking = existingBooking(data, session, player);
    const pass=prepaidEnrollment(data,session,player);
    if(pass&&booking&&booking.fields['Booking type']!=='Four consecutive sessions'&&booking.fields['Fixed-price package']!==true) deny('ROSTER_BOOKING_CONFLICT',409);
    if(!booking&&!pass&&!usesSessionRate(session))checkRates(data,session,player);
    const key = 'coach:' + session.id + ':' + player.id;
    if (!booking&&!pass) {
      const previous = data.bookings.filter(row => row.fields['Source booking ID'] === key);
      if (previous.length) deny('ROSTER_BOOKING_CONFLICT', 409);
      const historical = session.fields.Date < '2026-11-21';
      booking = await db.save('bookings', {
        'Source booking ID':key, 'Booking reference':key, Player:[player.id],
        ...(links(player.fields.Family).length ? {Family:player.fields.Family} : {}),
        'Booking type':'Drop-in', 'Booking status':'Accepted',
        'Charge review':historical ? 'Needs pricing confirmation' : 'Agreed',
        ...(historical ? {Notes:'Coach Desk requested per-session rate: CAD ' + (rateCents / 100).toFixed(2) + '. Historical attendance needs billing review.'} : {'Charge CAD':rateCents / 100}),
        'First session':[session.id], 'Start date':session.fields.Date, 'Covered dates':session.fields.Date
      }, {key:'Source booking ID'});
      data.bookings.push(booking);
    }
    if (data.attendance.some(row => row.fields['Source coverage key'] === key)) deny('ROSTER_CONFLICT', 409);
    const attendance = await db.save('attendance', {
      'Source coverage key':key, 'Attendance entry':names(player.fields.Player) + ' · ' + names(session.fields.Session),
      Player:[player.id], Session:[session.id], ...(booking?{Booking:[booking.id]}:{Enrollment:[pass.id]}), 'Coverage state':'Active',
      'Coverage approved':true, 'Session date':session.fields.Date, 'Attendance status':'Not marked',
      ...(pass||booking?.fields['Booking type'] === 'Four consecutive sessions' ?
        {'Billing schedule at date':'Four-session prepaid','Billing review':'Approved coverage'} : {})
    }, {key:'Source coverage key'});
    data.attendance.push(attendance);
    return true;
  }
  async function enrollment(data, player, session, rateCents, commandId) {
    const programId = programFor(session);
    if (!programId) deny('ROSTER_NOT_RECURRING', 409);
    const existing = data.enrollments.filter(({fields:item}) => links(item.Player).includes(player.id) && links(item['Weekly program']).includes(programId) && item['Enrollment status'] === 'Active');
    if (existing.length > 1) deny('ROSTER_ENROLLMENT_CONFLICT', 409);
    if (existing.length) {
      const item = existing[0].fields;
      if (!one(item.Player, player.id) || !one(item['Weekly program'], programId) ||
          links(item.Family).length > 1 || links(item.Family).length && !one(player.fields.Family, item.Family[0])) deny('ROSTER_ENROLLMENT_CONFLICT', 409);
      return existing[0];
    }
    const key = 'Coach Desk ' + player.id + ' ' + programId + ' ' + commandId;
    if (data.enrollments.some(row => row.fields.Enrollment === key)) deny('ROSTER_ENROLLMENT_CONFLICT', 409);
    const created = await db.save('enrollments', {
      Enrollment:key, Player:[player.id], ...(links(player.fields.Family).length ? {Family:player.fields.Family} : {}),
      'Weekly program':[programId], 'Enrollment status':'Active', 'Effective from':session.fields.Date,
      'Billing schedule':'Per session', 'Billing approval':'Approved', 'Agreed per-session CAD':rateCents / 100,
      'Weekly attendance email preference':'Unknown'
    }, {key:'Enrollment'});
    data.enrollments.push(created);
    return created;
  }
  return {
    async options(sessionId) {
      if (!recordId.test(sessionId || '')) deny('INVALID_REQUEST', 400);
      const tablesToRead=['sessions','players','families','programs','enrollments'];
      const data=Object.fromEntries(await Promise.all(tablesToRead.map(async name=>[name,await db.list(name,readColumns(name))])));
      const session = sessionFor(data, sessionId), programId = programFor(session);
      const program = data.programs.find(row => row.id === programId)?.fields;
      return {
        recurring:!!programId,
        rate:usesSessionRate(session) ? (rateFor(data,session) === null ? null : rateFor(data,session)/100) :
          Number.isFinite(program?.['Drop-in CAD']) && program['Drop-in CAD'] >= 0 ? program['Drop-in CAD'] : null,
        rateLocked:usesSessionRate(session) && rateFor(data,session) !== null,
        players:data.players.filter(row => names(row.fields.Player) && row.fields['Player status'] !== 'Inactive')
          .map(row => {
            const family=links(row.fields.Family);
            const agreed=data.enrollments.filter(({fields:item})=>one(item.Player,row.id)&&one(item['Weekly program'],programId)&&
              (family.length===1?one(item.Family,family[0]):!family.length&&!links(item.Family).length)&&
              item['Enrollment status']==='Active'&&item['Billing schedule']==='Per session'&&item['Billing approval']==='Approved'&&
              (!item['Effective from']||item['Effective from']<=session.fields.Date)&&(!item['Effective until']||item['Effective until']>=session.fields.Date)&&
              Number.isFinite(item['Agreed per-session CAD'])&&item['Agreed per-session CAD']>=0);
            return {id:row.id,name:names(row.fields.Player),familyId:links(row.fields.Family).length === 1 ? row.fields.Family[0] : null,
              ...(!usesSessionRate(session)&&agreed.length===1?{agreedRate:agreed[0].fields['Agreed per-session CAD']}:{})};
          })
          .sort((a,b) => a.name.localeCompare(b.name)),
        families:data.families.map(row => ({id:row.id,name:names(row.fields['Guardian name']) || names(row.fields.Family) || 'Unnamed family'}))
          .sort((a,b) => a.name.localeCompare(b.name))
      };
    },
    async add(actor, input) {
      const {id,sessionId,playerId,newName,familyId,mode,rateCents} = input;
      if (!commandId.test(id || '') || !recordId.test(sessionId || '') || !['dropin','permanent'].includes(mode) ||
          !Number.isSafeInteger(rateCents) || rateCents < 0 || rateCents > 10000000 ||
          (!!playerId === !!newName) || playerId && !recordId.test(playerId) ||
          newName && (names(newName).length < 1 || names(newName).length > 100) ||
          familyId && (!newName || !recordId.test(familyId))) deny('INVALID_ROSTER_PLAYER', 400);
      const payload = JSON.stringify({sessionId,playerId:playerId || null,newName:names(newName),familyId:familyId || null,mode,rateCents});
      let command = store.get('SELECT * FROM coach_roster_commands WHERE id=?', id);
      if (command && (command.actor !== actor || command.payload !== payload)) deny('ROSTER_REQUEST_REUSED', 409);
      if (command?.result) return {...JSON.parse(command.result),duplicate:true};
      if (!command) {
        store.run('INSERT INTO coach_roster_commands(id,actor,payload) VALUES(?,?,?)', id, actor, payload);
        command = {id,actor,payload};
      }
      const data = await snapshot(), session = sessionFor(data, sessionId);
      if (mode === 'permanent' && !programFor(session)) deny('ROSTER_NOT_RECURRING', 409);
      if (usesSessionRate(session)) {
        const known = rateFor(data,session);
        if (known !== null && known !== rateCents) deny('ROSTER_RATE_CHANGED',409);
        if (known === null) {
          if (data.attendance.some(row => one(row.fields.Session,session.id) &&
              row.fields['Coverage state']==='Active' && row.fields['Attendance status']==='Present')) deny('ROSTER_RATE_REVIEW',409);
          // The first owner to set a price sets it for the session, not just
          // for the selected player. Subsequent additions must use that price.
          await db.save('sessions',{[sessionRateField]:rateCents/100},{id:session.id});
          session.fields[sessionRateField] = rateCents/100;
        }
      }
      let player;
      if (playerId || command.player_id) player = playerFor(data, playerId || command.player_id);
      else {
        if (familyId && !data.families.some(row => row.id === familyId)) deny('ROSTER_FAMILY_CONFLICT', 409);
        const key = 'coach:' + id;
        const previous = data.players.filter(row => row.fields['Source player ID'] === key);
        if (previous.length > 1) deny('ROSTER_CONFLICT', 409);
        if (previous[0] && (names(previous[0].fields.Player) !== names(newName) ||
          (familyId ? !one(previous[0].fields.Family, familyId) : links(previous[0].fields.Family).length))) deny('ROSTER_CONFLICT', 409);
        player = previous[0] || await db.save('players', {
          'Source player ID':key, Player:names(newName), 'Player status':'Active', ...(familyId ? {Family:[familyId]} : {})
        }, {key:'Source player ID'});
        if (!previous.length) data.players.push(player);
        store.run('UPDATE coach_roster_commands SET player_id=? WHERE id=?', player.id, id);
      }
      // Detect a conflicting prior booking before creating a permanent enrollment.
      const selectedSeat=existingSeat(data,session.id,player.id);
      if(selectedSeat&&selectedSeat.fields['Coverage state']!=='Active')deny('ROSTER_CONFLICT',409);
      if(!selectedSeat){
        const booking=existingBooking(data,session,player),pass=prepaidEnrollment(data,session,player);
        if(pass&&booking&&booking.fields['Booking type']!=='Four consecutive sessions'&&booking.fields['Fixed-price package']!==true)deny('ROSTER_BOOKING_CONFLICT',409);
        if(!booking&&!pass&&!usesSessionRate(session))checkRates(data,session,player);
      }
      let member;
      if (mode === 'permanent') {
        const enrolled = await enrollment(data, player, session, rateCents, id), programId = programFor(session);
        member = {playerId:player.id,programId,enrollmentId:enrolled.id,startDate:session.fields.Date,rateCents,
          independent:enrolled.fields['Billing schedule']==='Four-session prepaid'||!!enrolled.fields['Effective until'],
          followRate:enrolled.fields['Billing schedule']==='Per session'&&enrolled.fields['Billing approval']==='Approved'&&
            Number.isFinite(enrolled.fields['Agreed per-session CAD'])&&Math.round(enrolled.fields['Agreed per-session CAD']*100)===rateCents};
        store.run(`INSERT INTO coach_roster_memberships(player_id,program_id,enrollment_id,start_date,rate_cents,independent,follow_rate)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(player_id,program_id) DO UPDATE SET enrollment_id=excluded.enrollment_id,
          start_date=MIN(start_date,excluded.start_date),rate_cents=excluded.rate_cents,independent=excluded.independent,follow_rate=excluded.follow_rate`,
          player.id, programId, enrolled.id, member.startDate, rateCents, Number(member.independent),Number(member.followRate));
      }
      const dates = member ? data.sessions.filter(row => row.id === session.id ||
        programFor(row) === member.programId && date(row.fields.Date) && row.fields.Date >= session.fields.Date &&
        ['Planned','Confirmed'].includes(row.fields['Session status'])) : [session];
      let added = 0;
      const reviewDates = [];
      for (const row of dates) {
        try {
          const datedRate = usesSessionRate(row) ? rateFor(data,row) : rateCents;
          if (datedRate === null && !existingSeat(data,row.id,player.id) &&
              !existingBooking(data,row,player) && !prepaidEnrollment(data,row,player)) {
            if (row.id === session.id) deny('ROSTER_RATE_CHANGED',409);
            reviewDates.push(row.fields.Date); continue;
          }
          if (await seat(data, row, player, datedRate ?? 0)) added++;
        }
        catch (error) {
          if (row.id === session.id || error?.status !== 409) throw error;
          reviewDates.push(row.fields.Date);
        }
      }
      const result = {saved:true,playerId:player.id,added,recurring:!!member,reviewDates,historicalReview:session.fields.Date < '2026-11-21'};
      store.run('UPDATE coach_roster_commands SET result=? WHERE id=?', JSON.stringify(result), id);
      return result;
    },
    async sync() {
      const memberships = store.all('SELECT * FROM coach_roster_memberships');
      if (!memberships.length) return {added:0,issues:[]};
      const tablesToRead=['sessions','attendance','enrollments',...(sessionRateField?['programs']:[])];
      const data=Object.fromEntries(await Promise.all(tablesToRead.map(async name=>[name,await db.list(name,readColumns(name))])));
      const work=memberships.some(member=>{
        const enrolled=data.enrollments.find(row=>row.id===member.enrollment_id)?.fields;
        if(['Paused','Needs review'].includes(enrolled?.['Enrollment status']))return false;
        if(!member.independent&&(!enrolled||enrolled['Enrollment status']!=='Active'||
          !one(enrolled.Player,member.player_id)||!one(enrolled['Weekly program'],member.program_id)))return false;
        const first=[today(),member.start_date,member.independent?'':enrolled['Effective from']||''].sort().at(-1);
        return data.sessions.some(session=>{
          if(programFor(session)!==member.program_id||!date(session.fields.Date)||session.fields.Date<first||
            !member.independent&&enrolled['Effective until']&&session.fields.Date>enrolled['Effective until']||
            !['Planned','Confirmed'].includes(session.fields['Session status']))return false;
          const seats=data.attendance.filter(row=>links(row.fields.Session).includes(session.id)&&links(row.fields.Player).includes(member.player_id));
          return seats.length!==1||!one(seats[0].fields.Session,session.id)||!one(seats[0].fields.Player,member.player_id)||
            !['Active','Void'].includes(seats[0].fields['Coverage state']);
        });
      });
      if(!work)return {added:0,issues:[]};
      const [players,bookings]=await Promise.all([db.list('players',fields.players),db.list('bookings',fields.bookings)]);
      Object.assign(data,{players,bookings});
      let added = 0;
      const issues=[];
      for (const member of memberships) {
        const enrolled = data.enrollments.find(row => row.id === member.enrollment_id)?.fields;
        if(['Paused','Needs review'].includes(enrolled?.['Enrollment status']))continue;
        if (!member.independent && (!enrolled || enrolled['Enrollment status'] !== 'Active' || !one(enrolled.Player, member.player_id) || !one(enrolled['Weekly program'], member.program_id))) continue;
        const player = data.players.find(row => row.id === member.player_id);
        if (!player || player.fields['Player status'] === 'Inactive') continue;
        const first = [today(),member.start_date,member.independent?'':enrolled['Effective from'] || ''].sort().at(-1);
        const currentRate=member.follow_rate&&enrolled?.['Billing approval']==='Approved'&&
          enrolled['Billing schedule']==='Per session'&&Number.isFinite(enrolled['Agreed per-session CAD'])&&enrolled['Agreed per-session CAD']>=0
          ?Math.round(enrolled['Agreed per-session CAD']*100):member.follow_rate?null:member.rate_cents;
        for (const session of data.sessions.filter(row => programFor(row) === member.program_id && date(row.fields.Date) && row.fields.Date >= first &&
          (member.independent || !enrolled['Effective until'] || row.fields.Date <= enrolled['Effective until']) && ['Planned','Confirmed'].includes(row.fields['Session status']))) {
          try {
            const datedRate=usesSessionRate(session)?rateFor(data,session):currentRate;
            if(datedRate===null&&!existingSeat(data,session.id,player.id)&&
              !existingBooking(data,session,player)&&!prepaidEnrollment(data,session,player)){
              issues.push({sessionId:session.id,player:names(player.fields.Player),reason:usesSessionRate(session)?'Session rate needs review':'Permanent player’s rate needs review'});
              continue;
            }
            if (await seat(data, session, player, datedRate??0,true)) added++;
          }
          catch (error) {
            if (error?.status !== 409) throw error;
            issues.push({sessionId:session.id,player:names(player.fields.Player),reason:'Permanent player needs roster review'});
          }
        }
      }
      return {added,issues};
    }
  };
}
