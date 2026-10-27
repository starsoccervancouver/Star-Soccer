/* Explicit public artifact: never publish tests, dependencies or reference screenshots. */
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
fs.mkdirSync('_site', { recursive: true });
for(const name of ['autumn-training-800.webp','autumn-training-1600.webp','winter-training-800.webp','winter-training-1600.webp']){
  const obsolete=path.join('_site',name);if(fs.existsSync(obsolete))fs.unlinkSync(obsolete);
}
for (const name of fs.readdirSync('.')) {
  if (/\.(html|svg)$/.test(name) || ['campaign-source.js', 'star-soccer-social.jpg', 'email-star-soccer-logo.png', 'email-autumn-field.jpg', 'email-winter-field.jpg', 'weekly-signup.js', 'weekly-signup-form.js', 'pass-calendar.js', 'quick-forms.css', 'homepage-conversion.css', 'private-inquiry.css', 'page-themes.css', 'number-controls.css', 'number-controls.js', 'winter-field-800.webp', 'winter-field-1600.webp', 'winter-camps.js', 'camp-booking.js', 'autumn-field-800.webp', 'autumn-field-1600.webp', 'site.min.css', 'site-ux.js', 'training.js', 'booking.js', 'session-counts.js', 'legacy-redirect.js', 'sitemap.xml', 'robots.txt', 'CNAME'].includes(name)) {
    fs.copyFileSync(name, path.join('_site', name));
  }
}
fs.mkdirSync('_site/Star soccer', { recursive: true });
for (const name of fs.readdirSync('Star soccer').filter(name => name.endsWith('.html'))) {
  fs.copyFileSync(path.join('Star soccer', name), path.join('_site/Star soccer', name));
}
fs.writeFileSync('_site/.nojekyll', '');
