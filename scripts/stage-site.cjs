/* Explicit public artifact: never publish tests, dependencies or reference screenshots. */
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
fs.mkdirSync('_site', { recursive: true });
if(fs.existsSync(path.join('_site','private-attendance')))throw new Error('Refusing to publish a staging directory containing private attendance tools. Use a clean public staging directory.');
for(const name of ['autumn-training-800.webp','autumn-training-1600.webp','winter-training-800.webp','winter-training-1600.webp']){
  const obsolete=path.join('_site',name);if(fs.existsSync(obsolete))fs.unlinkSync(obsolete);
}
const googleTag = `
<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-K9WVBH7V"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
</script>
`;

// Keep tracking off staff sign-in, booking receipts and legacy redirects.
function stageHtml(name) {
  const html = fs.readFileSync(name, 'utf8');
  const destination = path.join('_site', name);
  if (['coach.html', 'registration-thank-you.html'].includes(name) || /<body\b[^>]*\bdata-redirect\s*=/i.test(html)) {
    fs.writeFileSync(destination, html);
    return;
  }
  if (/googletagmanager\.com\/(?:gtm\.js|gtag\/js)/i.test(html)) {
    throw new Error(name + ': Google tags are installed once by the public staging script');
  }
  const head = /<head\b[^>]*>/i;
  if (!head.test(html)) throw new Error(name + ': expected an opening head tag');
  fs.writeFileSync(destination, html.replace(head, opening => opening + googleTag));
}

for (const name of fs.readdirSync('.')) {
  if(name==='private-attendance')continue; // Never publish private parent/staff tools or state through Pages.
  if (name.endsWith('.html')) {
    stageHtml(name);
    continue;
  }
  if (/\.svg$/.test(name) || ['football-news.js', 'football-news.json', 'pro-d-camp.js', 'training-layout.css', 'seasonal-photos.css', 'form-service.js', 'form-recovery.js', 'family-registration.js', 'family-registration.css', 'registration-funnel.js', 'campaign-source.js', 'star-soccer-social.jpg', 'star-soccer-brand-master.png', 'email-star-soccer-logo.png', 'email-autumn-field.jpg', 'email-winter-field.jpg', 'weekly-signup.js', 'weekly-signup-form.js', 'pass-calendar.js', 'quick-forms.css', 'homepage-conversion.css', 'private-inquiry.css', 'page-themes.css', 'number-controls.css', 'number-controls.js', 'winter-field-800.webp', 'winter-field-1600.webp', 'winter-camps.js', 'camp-booking.js', 'autumn-field-800.webp', 'autumn-field-1600.webp', 'site.min.css', 'site-ux.js', 'training.js', 'booking.js', 'session-counts.js', 'legacy-redirect.js', 'sitemap.xml', 'robots.txt', 'CNAME'].includes(name)) {
    fs.copyFileSync(name, path.join('_site', name));
  }
}
fs.mkdirSync('_site/Star soccer', { recursive: true });
for (const name of fs.readdirSync('Star soccer').filter(name => name.endsWith('.html'))) {
  fs.copyFileSync(path.join('Star soccer', name), path.join('_site/Star soccer', name));
}
fs.writeFileSync('_site/.nojekyll', '');
// Only vetted public fonts/photos and their attribution; no workspace folders.
for(const directory of ['fonts','site-photos'])fs.cpSync(directory,path.join('_site',directory),{recursive:true});
for(const season of ['autumn','winter'])for(const width of [800,1600]){
  const name=`${season}-field-${width}.avif`;fs.copyFileSync(name,path.join('_site',name));
}
