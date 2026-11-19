import {Buffer} from 'node:buffer';
import {createHmac,timingSafeEqual} from 'node:crypto';

const lifetime = 30 * 60 * 1000;
export const previewCookie = '__Host-ss_operations_read';
const vancouverDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function createOperationsPreview({cookieKey, origin, coaches, overview, familyLedger, clock}) {
  function signature(payload) {
    return createHmac('sha256',cookieKey).update('coachdesk:operations-read:v1:'+origin+':'+payload).digest('base64url');
  }
  return {
    issue(owner) {
      coaches.owner(owner);
      const payload = Buffer.from(JSON.stringify([owner.email,owner.sessionVersion,clock()+lifetime])).toString('base64url');
      return previewCookie+'='+payload+'.'+signature(payload)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+lifetime/1000;
    },
    authenticate(raw) {
      if (typeof raw !== 'string' || raw.length > 1024) return null;
      const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(raw);
      if (!parts || !timingSafeEqual(Buffer.from(parts[2]),Buffer.from(signature(parts[1])))) return null;
      const [email,version,expires] = JSON.parse(Buffer.from(parts[1],'base64url').toString());
      if (expires <= clock() || expires > clock()+lifetime) return null;
      const actor = coaches.actor(email);
      return actor.role === 'owner' && actor.sessionVersion === version ? actor : null;
    },
    async read(owner) {
      coaches.owner(owner);
      const data = coaches.scope(owner,await overview({}));
      const today = Date.parse(vancouverDate.format(new Date(clock()))+'T00:00:00Z');
      const dateAt = days => new Date(today+days*86400000).toISOString().slice(0,10);
      const start = dateAt(-13), end = dateAt(6);
      const sessions = data.sessions.filter(s => s.date >= start && s.date <= end).map(s => ({
        sessionId:s.id,date:s.date,time:s.time,status:s.status,expected:s.expected,
        players:s.players.map(p => ({
          attendanceId:p.attendanceId,playerId:p.playerId,kind:p.kind,preparation:p.status,attendance:p.actualAttendance
        }))
      }));
      const balances = await familyLedger.balances();
      return {source:'Coach Desk Owner',permission:'operations:read',timeZone:'America/Vancouver',
        sessionWindow:{start,end},rosterObservedAt:data.observedAt,balancesReadAt:new Date(clock()).toISOString(),
        sessions,balances};
    }
  };
}
