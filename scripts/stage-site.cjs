/* Explicit public artifact: never publish tests, dependencies or reference screenshots. */
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
fs.mkdirSync('_site', { recursive: true });
for (const name of fs.readdirSync('.')) {
  if (/\.(html|svg)$/.test(name) || ['quick-forms.css', 'winter-training-800.webp', 'winter-training-1600.webp', 'winter-camps.js', 'camp-booking.js', 'autumn-training-800.webp', 'autumn-training-1600.webp', 'site.min.css', 'site-ux.js', 'training.js', 'booking.js', 'session-counts.js', 'legacy-redirect.js', 'sitemap.xml', 'robots.txt', 'CNAME'].includes(name)) {
    fs.copyFileSync(name, path.join('_site', name));
  }
}
fs.mkdirSync('_site/Star soccer', { recursive: true });
for (const name of fs.readdirSync('Star soccer').filter(name => name.endsWith('.html'))) {
  fs.copyFileSync(path.join('Star soccer', name), path.join('_site/Star soccer', name));
}
fs.writeFileSync('_site/.nojekyll', '');
