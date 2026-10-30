/** Public presentation settings only. This object never controls permissions or capacity. */
export function validateClubConfig(input) {
  const allowed = ['name', 'siteUrl', 'timeZone', 'trainingDays', 'accent'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw Error('INVALID_CLUB_CONFIG');
  const {name, siteUrl, timeZone, trainingDays, accent = '#e7c59a'} = input;
  if (typeof name !== 'string' || name !== name.trim() || !name || name.length > 70 || /[\x00-\x1f\x7f<>]/.test(name)) throw Error('INVALID_CLUB_NAME');
  let site;
  try { site = new URL(siteUrl); } catch { throw Error('INVALID_CLUB_SITE'); }
  if (typeof siteUrl !== 'string' || site.protocol !== 'https:' || site.username || site.password || site.search || site.hash || site.port || !site.hostname.includes('.') || siteUrl.length > 250) throw Error('INVALID_CLUB_SITE');
  if (typeof timeZone !== 'string' || timeZone.length > 60) throw Error('INVALID_CLUB_TIMEZONE');
  try { new Intl.DateTimeFormat('en-CA', {timeZone}).format(new Date()); } catch { throw Error('INVALID_CLUB_TIMEZONE'); }
  if (!Array.isArray(trainingDays) || !trainingDays.length || trainingDays.length > 7 || trainingDays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(trainingDays).size !== trainingDays.length) throw Error('INVALID_CLUB_DAYS');
  if (typeof accent !== 'string' || !/^#[a-f0-9]{6}$/i.test(accent)) throw Error('INVALID_CLUB_ACCENT');
  // Accent is used behind dark labels. Require a light color to preserve contrast.
  const rgb = accent.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  if (luminance < .4) throw Error('CLUB_ACCENT_MUST_BE_LIGHT');
  return Object.freeze({name, siteUrl: site.href, timeZone, trainingDays: Object.freeze([...trainingDays]), accent: accent.toLowerCase()});
}

export function clubConfigScript(input) {
  const config = validateClubConfig(input);
  // Fixed code, validated JSON and text/attribute setters only; never HTML interpolation.
  return "(()=>{'use strict';const config=" + JSON.stringify(config).replaceAll('<', '\\u003c') + ";Object.freeze(config.trainingDays);Object.freeze(config);Object.defineProperty(window,'CoachClub',{value:config,writable:false,configurable:false});document.title='Coach Desk | '+config.name;document.querySelectorAll('[data-club-name]').forEach(el=>el.textContent=config.name);document.querySelectorAll('a[data-club-site]').forEach(el=>el.href=config.siteUrl);document.querySelectorAll('img[data-club-logo]').forEach(el=>el.alt=config.name);document.documentElement.style.setProperty('--desk-gold',config.accent);})();\n";
}
