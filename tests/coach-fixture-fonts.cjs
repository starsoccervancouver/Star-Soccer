/* Same-origin assets for isolated Coach Desk browser fixtures. */
const fs = require('node:fs');
const path = require('node:path');
module.exports = function addCoachFixtureFonts(assets) {
  for (const [url, file] of [
    ['/workspace/assets/manrope.woff2', 'manrope-normal-latin.woff2'],
    ['/workspace/assets/instrument-serif.woff2', 'instrument-serif-italic-latin.woff2'],
  ]) assets[url] = { body: fs.readFileSync(path.join(__dirname, '..', 'fonts', file)), type: 'font/woff2' };
  for (const [url, file, type] of [
    ['/workspace/assets/dictation.js', 'workspace-dictation.js', 'text/javascript'],
    ['/workspace/assets/coaching.js', 'workspace-coaching.js', 'text/javascript'],
    ['/workspace/assets/coaching.css', 'workspace-coaching.css', 'text/css'],
    ['/workspace/assets/session.js', 'workspace-session.js', 'text/javascript'],
    ['/workspace/assets/session.css', 'workspace-session.css', 'text/css'],
  ]) {
    const location = path.join(__dirname, '..', 'private-attendance', 'web', file);
    if (fs.existsSync(location)) assets[url] = { body: fs.readFileSync(location, 'utf8'), type };
  }
  const config = require('../private-attendance/club-config.json');
  assets['/workspace/assets/club-config.js'] = { body: 'window.CoachClub=Object.freeze('+JSON.stringify(config)+');', type: 'text/javascript' };
  return assets;
};
