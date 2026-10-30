/* Read-only planning from an explicitly normalized Airtable export. Never imports or writes. */
const IDENTIFIER = /^[A-Za-z0-9:_-]{1,100}$/;
const calendarDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const iso = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  calendarDate(value.slice(0,10)) && Number(value.slice(11,13))<24 && Number(value.slice(14,16))<60 && Number(value.slice(17,19))<60 && Number.isFinite(Date.parse(value));
const activeKinds = new Set(['dropin','pass','camp']);
const identifier = value => typeof value === 'string' && IDENTIFIER.test(value);
const displayText=(value,max=100)=>typeof value==='string' && value.trim().length>0 && value.length<=max && !/[\x00-\x1f]/.test(value);
function index(records,kind,issues) {
  const result = new Map();
  for (const row of records) {
    if (!row || !identifier(row.id) || result.has(row.id)) {issues.push({code:'invalid_or_duplicate_'+kind+'_id',recordId:row?.id??null});continue;}
    result.set(row.id,row);
  }
  return result;
}

/**
 * Input is a private export normalized to IDs (not names or fuzzy matches).
 * No email preference is inferred from marketing consent or Calendar approval.
 * Candidate snapshots are deliberately not approved and cannot be imported by the demo service.
 */
export function planMigration({sessions=[],players=[],families=[],bookings=[],enrollments=[],attendance=[],
  observedAt,revision=1,snapshotId='migration-review'} = {}) {
  const blockingIssues=[],warnings=[];
  for (const rows of [sessions,players,families,bookings,enrollments,attendance]) if (!Array.isArray(rows) || rows.length>10000) throw new Error('Invalid bounded migration input.');
  if (!iso(observedAt) || !Number.isSafeInteger(revision) || revision<1 || !identifier(snapshotId)) throw new Error('Use an explicit export timestamp, revision and snapshot identifier.');
  const sm=index(sessions,'session',blockingIssues),pm=index(players,'player',blockingIssues),fm=index(families,'family',blockingIssues),bm=index(bookings,'booking',blockingIssues),em=index(enrollments,'enrollment',blockingIssues);
  const outputSessions=new Map();
  for (const session of sm.values()) {
    if (session.capacity!==20 || !Number.isSafeInteger(session.ownerExpected) || session.ownerExpected<0 || session.ownerExpected>20 ||
        !calendarDate(session.date) || !iso(session.startAt) || !iso(session.endAt) || Date.parse(session.endAt)<=Date.parse(session.startAt) ||
        !['scheduled','cancelled','completed'].includes(session.status) || !displayText(session.label,150) || !displayText(session.location,200)) {
      blockingIssues.push({code:'invalid_session_or_capacity',recordId:session.id});continue;
    }
    outputSessions.set(session.id,{id:session.id,date:session.date,label:session.label,startAt:session.startAt,endAt:session.endAt,
      location:session.location,capacity:20,status:session.status,ownerExpected:session.ownerExpected,entries:[]});
  }
  const ids=new Set(),pairs=new Map(),sourceKeys=new Map(),preserveAttendanceIds=[],legacyCoverageKeyIds=[];
  for (const row of attendance) {
    if (!row || !identifier(row.id) || ids.has(row.id)) {blockingIssues.push({code:'invalid_or_duplicate_attendance_id',recordId:row?.id??null});continue;}
    ids.add(row.id);preserveAttendanceIds.push(row.id);
    if (!row.sourceCoverageKey) {legacyCoverageKeyIds.push(row.id);warnings.push({code:'legacy_missing_coverage_key_preserve_record',recordId:row.id});}
    if (row.coverageState==='void') continue;
    if (row.coverageState!=='active') {blockingIssues.push({code:'unknown_coverage_state',recordId:row.id});continue;}
    if (row.sourceCoverageKey) {
      if (sourceKeys.has(row.sourceCoverageKey)) blockingIssues.push({code:'duplicate_source_coverage_key',recordId:row.id,otherRecordId:sourceKeys.get(row.sourceCoverageKey)});
      sourceKeys.set(row.sourceCoverageKey,row.id);
    }
    const session=outputSessions.get(row.sessionId),player=pm.get(row.playerId),family=fm.get(player?.familyId);
    if (!session || !player || !family || !['active','name-to-confirm'].includes(player.status) || !displayText(player.name) ||
        (family.guardianName!==undefined && family.guardianName!==null && !displayText(family.guardianName))) {
      blockingIssues.push({code:'unresolved_roster_identity',recordId:row.id});continue;
    }
    // A row's self-reported date must not authorize a different linked dated session.
    // Use the authoritative Dated Attendance date, not a substring supplied by that row.
    if (row.sessionDate!==undefined && row.sessionDate!==session.date) {
      blockingIssues.push({code:'coverage_session_date_conflict',recordId:row.id});continue;
    }
    const pair=JSON.stringify([row.playerId,row.sessionId]);
    if (pairs.has(pair)) {blockingIssues.push({code:'duplicate_player_session_requires_review',recordId:row.id,otherRecordId:pairs.get(pair)});continue;}
    pairs.set(pair,row.id);
    let kind,sourceValid=false;
    if (row.bookingId) {
      const booking=bm.get(row.bookingId);
      const covered=booking && ((Array.isArray(booking.coveredSessionIds)&&booking.coveredSessionIds.includes(session.id)) ||
        (Array.isArray(booking.coveredDates)&&booking.coveredDates.includes(session.date)));
      sourceValid=!!booking && booking.playerId===player.id && booking.familyId===family.id && booking.status==='accepted' && !!covered && activeKinds.has(booking.kind);
      kind=booking?.kind;
    } else if (row.enrollmentId) {
      const enrollment=em.get(row.enrollmentId);
      sourceValid=!!enrollment && enrollment.playerId===player.id && enrollment.familyId===family.id &&
        enrollment.status==='active' && enrollment.approved===true && activeKinds.has(enrollment.kind) &&
        Array.isArray(enrollment.sessionIds) && enrollment.sessionIds.includes(session.id);
      kind=enrollment?.kind;
    }
    if (!sourceValid) {blockingIssues.push({code:'unverified_approved_coverage',recordId:row.id});continue;}
    const preference=kind==='dropin' && ['enabled','disabled'].includes(family.reminderPreference) ? family.reminderPreference : kind==='dropin'?'unknown':'disabled';
    if (kind==='dropin' && (family.emailVerified!==true || preference!=='enabled')) warnings.push({code:'contact_or_reminder_preference_hold',recordId:row.id});
    session.entries.push({playerId:player.id,familyId:family.id,attendanceId:row.id,name:player.name,
      guardianName:typeof family.guardianName==='string'&&family.guardianName.trim()?family.guardianName.trim():null,
      emailVerified:family.emailVerified===true,kind,reserved:true,eligible:true,reminderPreference:preference});
  }
  for (const session of outputSessions.values()) if (session.entries.length>20) blockingIssues.push({code:'roster_over_capacity',recordId:session.id});
  return {readOnly:true,remoteWrites:0,readyForOwnerReview:blockingIssues.length===0,blockingIssues,warnings,
    preserveAttendanceIds,legacyCoverageKeyIds,physicalAttendancePreserved:true,bookingAndPaymentDataPreserved:true,
    summary:{attendanceRecords:attendance.length,legacyKeysMissing:legacyCoverageKeyIds.length,
      candidateSessions:outputSessions.size,candidateEntries:[...outputSessions.values()].reduce((n,s)=>n+s.entries.length,0)},
    candidateSnapshot:{schemaVersion:1,source:'airtable-candidate',snapshotId,revision,observedAt,complete:false,approved:false,sessions:[...outputSessions.values()]}};
}
