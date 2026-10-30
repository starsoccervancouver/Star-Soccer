/** Server-only identity. Presentation config cannot grant access or change the origin. */
export const STAR_SOCCER_ORIGIN = 'https://attendance.starsoccer.ca';
export const STAR_SOCCER_OWNER = 'starsoccervancouver@gmail.com';
export function validateWorkspaceOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('INVALID_COACH_ORIGIN'); }
  if (typeof value !== 'string' || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' || !url.hostname.includes('.') || value !== url.origin) throw Error('INVALID_COACH_ORIGIN');
  return url.origin;
}
export function deploymentIdentity(env = {}) {
  const origin = validateWorkspaceOrigin(env.COACH_ORIGIN || STAR_SOCCER_ORIGIN);
  const custom = origin !== STAR_SOCCER_ORIGIN;
  if (custom && (!env.COACH_OWNER_EMAIL || !env.COACH_OWNER_NAME)) throw Error('EXPLICIT_CLUB_OWNER_REQUIRED');
  const ownerEmail = env.COACH_OWNER_EMAIL || STAR_SOCCER_OWNER;
  const ownerName = env.COACH_OWNER_NAME || 'Star Soccer Owner';
  if (typeof ownerEmail !== 'string' || ownerEmail.length > 254 || !/^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i.test(ownerEmail)) throw Error('INVALID_COACH_OWNER');
  if (typeof ownerName !== 'string' || !ownerName.trim() || ownerName.length > 100 || /[\x00-\x1f<>]/.test(ownerName)) throw Error('INVALID_COACH_OWNER');
  return Object.freeze({origin, ownerEmail: ownerEmail.toLowerCase(), ownerName: ownerName.trim()});
}
