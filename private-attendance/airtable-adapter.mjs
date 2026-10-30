/* Private, RSVP-only projection. No fetch is performed in the default dry-run mode. */
const AIRTABLE_ID = /^(?:app|tbl|fld|rec)[A-Za-z0-9]{14}$/;
const IDENTIFIER = /^[A-Za-z0-9:_-]{1,100}$/;
const MARKER = '\n\n[StarSoccerAttendance:v1] ';
const SOURCE = 'custom-email-rsvp';
const identifier = value => typeof value === 'string' && IDENTIFIER.test(value);

export class MirrorError extends Error {
  constructor(code, {uncertain = false} = {}) {
    super(code); this.name = 'MirrorError'; this.code = code; this.uncertain = uncertain;
  }
}
const fail = code => { throw new MirrorError(code); };
const exactTime = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value)) && Number(value.slice(11,13))<24 && Number(value.slice(14,16))<60 && Number(value.slice(17,19))<60 &&
  new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===value.slice(0,10);
const id = (value, prefix) => typeof value === 'string' && value.startsWith(prefix) && AIRTABLE_ID.test(value);
const recordLinks = value => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v : v?.id) : [];

export function validateMirrorEvent(event) {
  const keys = ['eventId', 'playerId', 'sessionId', 'attendanceId', 'response', 'version', 'timestamp', 'source'];
  if (!event || typeof event !== 'object' || Object.keys(event).some(k => !keys.includes(k)) ||
      keys.some(k => !Object.hasOwn(event, k)) ||
      !['eventId','playerId','sessionId','attendanceId'].every(k => identifier(event[k])) ||
      !['yes','no'].includes(event.response) || !Number.isSafeInteger(event.version) || event.version < 1 ||
      !exactTime(event.timestamp) || event.source !== SOURCE) fail('invalid_mirror_event');
  return Object.freeze({...event});
}

export function parseMirrorNotes(value) {
  const notes = value === undefined || value === null ? '' : String(value);
  const at = notes.lastIndexOf(MARKER);
  if (at < 0) return {humanNotes: notes, event: null};
  let event;
  try { event = validateMirrorEvent(JSON.parse(notes.slice(at + MARKER.length))); }
  catch { fail('unrecognized_remote_mirror_metadata'); }
  return {humanNotes: notes.slice(0, at), event};
}

export function mirrorNotes(humanNotes, event) {
  validateMirrorEvent(event);
  if (String(humanNotes).includes(MARKER)) fail('unrecognized_remote_mirror_metadata');
  return String(humanNotes) + MARKER + JSON.stringify(event);
}

/**
 * This is not an Airtable transaction or a replacement for the private response store.
 * An approved deployment must have exactly one serialized projection writer. The
 * expected version lives in RSVP response notes until a reviewed dedicated field is
 * available. Never set dryRun:false merely because local tests passed.
 */
export function createAirtableAdapter({baseId, tableId, fields, token, fetchFn,
  dryRun = true, approval = null, exclusiveWriter = false, clock = () => new Date()} = {}) {
  if (!id(baseId,'app') || !id(tableId,'tbl')) fail('invalid_airtable_target');
  const fieldNames = ['rsvpStatus','rsvpUpdatedAt','rsvpNotes','player','session'];
  if (!fields || Object.keys(fields).some(k => !fieldNames.includes(k)) ||
      fieldNames.some(k => !id(fields[k],'fld')) || new Set(Object.values(fields)).size !== fieldNames.length) fail('invalid_field_mapping');
  const locks = new Map();
  function liveGate() {
    const now = clock().getTime();
    if (dryRun !== false || exclusiveWriter !== true || !approval || approval.ownerApproved !== true ||
        approval.scope !== 'attendance-rsvp-only' || approval.baseId !== baseId || approval.tableId !== tableId ||
        !exactTime(approval.approvedAt) || !exactTime(approval.expiresAt) ||
        Date.parse(approval.approvedAt) > now || Date.parse(approval.expiresAt) <= now ||
        !approval.handoffEvidence || typeof approval.handoffEvidence !== 'string' ||
        typeof token !== 'string' || !token || typeof fetchFn !== 'function') fail('live_mirror_not_approved');
  }
  function target(attendanceId) {
    if (!id(attendanceId,'rec')) fail('invalid_live_record_identity');
    return `https://api.airtable.com/v0/${baseId}/${tableId}/${attendanceId}?returnFieldsByFieldId=true`;
  }
  async function request(url, method = 'GET', body) {
    let response;
    try {
      response = await fetchFn(url, {method, headers: {Authorization: 'Bearer '+token, 'Content-Type':'application/json'},
        ...(body ? {body: JSON.stringify(body)} : {}), redirect:'manual', signal:AbortSignal.timeout(10000)});
    } catch { throw new MirrorError(method === 'PATCH' ? 'airtable_write_uncertain' : 'airtable_read_failed', {uncertain: method === 'PATCH'}); }
    if (!response?.ok) throw new MirrorError(method === 'PATCH' ? 'airtable_write_unverified' : 'airtable_read_failed', {uncertain: method === 'PATCH'});
    try { return await response.json(); }
    catch { throw new MirrorError(method === 'PATCH' ? 'airtable_write_uncertain' : 'airtable_read_failed', {uncertain: method === 'PATCH'}); }
  }
  function inspect(record, event,checkProjection=false) {
    if (record?.id !== event.attendanceId || !record.fields ||
        recordLinks(record.fields[fields.player]).length !== 1 || recordLinks(record.fields[fields.session]).length !== 1 ||
        recordLinks(record.fields[fields.player])[0] !== event.playerId || recordLinks(record.fields[fields.session])[0] !== event.sessionId) fail('airtable_identity_mismatch');
    const parsed = parseMirrorNotes(record.fields[fields.rsvpNotes]);
    if (parsed.event && (parsed.event.playerId !== event.playerId || parsed.event.sessionId !== event.sessionId || parsed.event.attendanceId !== event.attendanceId)) fail('remote_metadata_identity_mismatch');
    if(checkProjection&&parsed.event&&(record.fields[fields.rsvpStatus] !== (parsed.event.response==='yes'?'Yes':'No')||Date.parse(record.fields[fields.rsvpUpdatedAt])!==Date.parse(parsed.event.timestamp)))fail('remote_projection_mismatch');
    return parsed;
  }
  function equalEvent(a,b) { return a && Object.keys(b).every(k => a[k] === b[k]); }
  async function deliverUnlocked(input) {
    const event = validateMirrorEvent(input);
    if (dryRun !== false) return {status:'dry-run', eventId:event.eventId, readbackVersion:null,
      target:{baseId,tableId,attendanceId:event.attendanceId}, writesAllowed:false,
      permittedWriteFields:[fields.rsvpStatus,fields.rsvpUpdatedAt,fields.rsvpNotes], requiresReadBeforeWrite:true};
    liveGate();
    if (!id(event.playerId,'rec') || !id(event.sessionId,'rec')) fail('invalid_live_record_identity');
    const url = target(event.attendanceId), before = await request(url), parsed = inspect(before,event,true);
    if (parsed.event?.version > event.version) return {status:'superseded', eventId:event.eventId, readbackVersion:parsed.event.version};
    if (parsed.event?.version === event.version) {
      if (!equalEvent(parsed.event,event)) fail('remote_version_conflict');
      if (before.fields[fields.rsvpStatus] !== (event.response === 'yes' ? 'Yes':'No') ||
          Date.parse(before.fields[fields.rsvpUpdatedAt]) !== Date.parse(event.timestamp)) fail('remote_projection_mismatch');
      return {status:'delivered', eventId:event.eventId, readbackVersion:event.version, recovered:true};
    }
    // Only these three fields are permitted; links, booking, payment and physical attendance are never written.
    const patch = {[fields.rsvpStatus]:event.response === 'yes' ? 'Yes':'No',
      [fields.rsvpUpdatedAt]:event.timestamp, [fields.rsvpNotes]:mirrorNotes(parsed.humanNotes,event)};
    await request(url,'PATCH',{fields:patch});
    const after = await request(url), readback = inspect(after,event);
    if (!equalEvent(readback.event,event) || after.fields[fields.rsvpStatus] !== patch[fields.rsvpStatus] ||
        Date.parse(after.fields[fields.rsvpUpdatedAt]) !== Date.parse(event.timestamp)) throw new MirrorError('airtable_readback_mismatch',{uncertain:true});
    return {status:'delivered',eventId:event.eventId,readbackVersion:event.version,recovered:false};
  }
  return Object.freeze({dryRun:dryRun !== false, async deliver(event) {
    validateMirrorEvent(event);
    const previous = locks.get(event.attendanceId) || Promise.resolve();
    const active = previous.catch(()=>{}).then(()=>deliverUnlocked(event));
    locks.set(event.attendanceId,active);
    try { return await active; } finally { if (locks.get(event.attendanceId) === active) locks.delete(event.attendanceId); }
  }});
}

/** Manual/injected runner only. Dry-run projections never acknowledge the durable outbox. */
export async function projectOutbox({service,adapter,limit=20}={}) {
  if (!service || typeof service.listOutbox!=='function' || !adapter || typeof adapter.deliver!=='function' ||
      !Number.isSafeInteger(limit) || limit<1 || limit>100) fail('invalid_outbox_runner');
  const results=[];
  for (const row of service.listOutbox().slice(0,limit)) {
    const event=row.payload;
    try {
      const result=await adapter.deliver(event);
      if (['delivered','superseded'].includes(result.status)) {
        if (!Number.isSafeInteger(result.readbackVersion) || result.readbackVersion<event.version) fail('readback_required');
        service.markOutboxDelivered({eventId:event.eventId,readbackVersion:result.readbackVersion});
      }
      results.push({eventId:event.eventId,status:result.status,readbackVersion:result.readbackVersion});
    } catch (error) {
      const code=error instanceof MirrorError ? error.code.toUpperCase() : 'MIRROR_FAILED';
      service.recordOutboxFailure({eventId:event.eventId,code});
      results.push({eventId:event.eventId,status:'pending',code,uncertain:error instanceof MirrorError&&error.uncertain});
    }
  }
  return {results,remoteWritesAllowed:adapter.dryRun===false};
}
