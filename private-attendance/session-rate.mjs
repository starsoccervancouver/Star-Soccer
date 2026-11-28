// Existing agreements and charges before this date are left alone.
export const sessionRateCutover = '2026-11-27';
export const validSessionRate = value => Number.isFinite(value) && value >= 0 &&
  Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;

// A dated rate takes precedence. A weekly program's published rate is the
// fallback for dates created after the current batch of dated sessions.
export function sessionRate(session, program, rateField = 'Session rate CAD') {
  const dated = rateField && session?.[rateField];
  if (validSessionRate(dated)) return dated;
  if (rateField && session && Object.hasOwn(session,rateField)) return null;
  const weekly = program?.['Drop-in CAD'];
  return validSessionRate(weekly) ? weekly : null;
}
