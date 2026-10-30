const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {buildSearchData, readSources} = require('../scripts/build-search-data.cjs');
const training = require('../training.js').catalog;
const winter = require('../winter-camps.js').catalog;
const root = path.resolve(__dirname, '..');
const origin = 'https://starsoccer.ca';
const sources = readSources(root);
const built = buildSearchData(sources); // Pure preview: tests never rewrite HTML.
const graph = source => JSON.parse(source.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)[1])['@graph'];
const pages = Object.keys(built).filter(file => !/<body\b[^>]*data-redirect=/i.test(built[file]) && built[file].includes('application/ld+json'));
const node = (file, type) => graph(built[file]).find(item => item['@type'] === type);
const stripData = source => source.replace(/(<script\b[^>]*type="application\/ld\+json"[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2');
function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(item => walk(item, visit)); else walk(child, visit);
}

test('schema refresh is idempotent and changes no visible content, metadata, links or forms', () => {
  assert.deepEqual(buildSearchData(built), built);
  for (const file of Object.keys(sources)) {
    assert.equal(stripData(built[file]), stripData(sources[file]), file + ': only JSON-LD may change');
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), sources[file], 'Preview must not write ' + file);
  }
});

test('every generated reference resolves within its page graph and shared identities remain stable', () => {
  for (const file of pages) {
    const data = graph(built[file]);
    const ids = new Set(data.map(item => item['@id']));
    assert.equal(ids.size, data.length, file + ': duplicate identities');
    walk(data, item => {
      if (Object.keys(item).length === 1 && item['@id']) assert(ids.has(item['@id']), file + ': unresolved ' + item['@id']);
    });
    const organization = node(file, 'SportsOrganization');
    const website = node(file, 'WebSite');
    const page = node(file, 'WebPage');
    assert.equal(organization['@id'], origin + '/#organization');
    assert.equal(website['@id'], origin + '/#website');
    assert.equal(website.publisher['@id'], organization['@id']);
    assert.equal(page['@id'], page.url + '#webpage');
    assert.equal(page.isPartOf['@id'], website['@id']);
    assert.equal(page.about['@id'], organization['@id']);
  }
});

test('services appear only on current service landing pages with the actual provider and service area', () => {
  const expected = new Map([['programs.html', '#weekly-training'], ['program-private-small-group.html', '#private-coaching'], ['camps.html', '#winter-camps']]);
  for (const file of pages) {
    const services = graph(built[file]).filter(item => item['@type'] === 'Service');
    assert.equal(services.length, expected.has(file) ? 1 : 0, file + ': unrelated service scope');
    for (const service of services) {
      assert.equal(service['@id'], origin + '/' + file + expected.get(file));
      assert.equal(node(file, 'WebPage').mainEntity['@id'], service['@id']);
      assert.equal(service.provider['@id'], origin + '/#organization');
      assert.equal(service.areaServed['@type'], 'City');
      assert.equal(service.areaServed.name, 'Vancouver');
      assert.equal(service.description, file === 'programs.html'
        ? 'Weekly youth soccer training in Vancouver. Choose a drop-in or a four-session pass for your age group.'
        : node(file, 'WebPage').description);
      assert.equal(service.mainEntityOfPage['@id'], origin + '/' + file + '#webpage');
      assert(!('offers' in service), 'Do not imply price or availability from capacity');
      assert(!('serviceLocation' in service), 'serviceLocation belongs on ServiceChannel');
    }
  }
});

test('youth weekly and camp venue channels and audience ages match their scoped public catalogs', () => {
  const weekly = node('programs.html', 'Service');
  const active = training.sessions.filter(session => session.active && session.audience !== 'women' && Number.isFinite(session.minAge) && Number.isFinite(session.maxAge));
  assert.equal(weekly.name, 'Youth soccer training in Vancouver');
  assert.equal(weekly.serviceType, 'Youth soccer training');
  assert.equal(weekly.audience.suggestedMinAge, Math.min(...active.map(session => session.minAge)));
  assert.equal(weekly.audience.suggestedMaxAge, Math.max(...active.map(session => session.maxAge)));
  assert.deepEqual(weekly.availableChannel.map(channel => channel.serviceLocation['@id']).sort(),
    [...new Set(active.map(session => origin + '/locations.html#' + session.location))].sort());
  for (const channel of weekly.availableChannel) {
    assert.equal(channel['@type'], 'ServiceChannel');
    const url = new URL(channel.serviceUrl);
    const key = url.searchParams.get('location');
    assert(training.locations[key]);
    assert.equal(url.pathname, '/programs.html');
    assert.equal(url.hash, '#sessions');
    assert.equal(channel.serviceLocation['@id'], origin + '/locations.html#' + key);
    assert.notEqual(key, 'fen-burdett', 'Youth service channels do not inherit the women’s venue or an unadvertised age gate');
  }
  const camp = node('camps.html', 'Service');
  assert.equal(camp.audience.suggestedMinAge, winter.minAge);
  assert.equal(camp.audience.suggestedMaxAge, winter.maxAge);
  assert.equal(camp.availableChannel.length, 1);
  const campVenue = graph(built['camps.html']).find(item => item['@id'] === camp.availableChannel[0].serviceLocation['@id']);
  assert.equal(campVenue.name, winter.location);
  assert.equal(camp.availableChannel[0]['@type'], 'ServiceChannel');
  const privateService = node('program-private-small-group.html', 'Service');
  for (const property of ['availableChannel', 'location', 'serviceLocation', 'address', 'audience']) {
    assert(!(property in privateService), 'No fixed private venue or unsupported private age range');
  }
});

test('the three public venue identities are shared without asserting a business address or headquarters', () => {
  const expectedIds = ['connaught', 'kits', 'fen-burdett'].map(key => origin + '/locations.html#' + key);
  const expectedNames = Object.values(training.locations).map(location => location.name).sort();
  for (const file of pages) {
    const organization = node(file, 'SportsOrganization');
    for (const property of ['address', 'foundingDate', 'branchOf', 'parentOrganization', 'subOrganization', 'department']) assert(!(property in organization), file + ': unsupported organization ' + property);
    assert.deepEqual(organization.location.map(item => item['@id']), expectedIds);
    const places = graph(built[file]).filter(item => item['@type'] === 'Place');
    assert.deepEqual(places.map(place => place['@id']), expectedIds);
    assert.deepEqual(places.map(place => place.name).sort(), expectedNames);
    for (const place of places) {
      assert.equal(place.url, place['@id']);
      assert.deepEqual(place.address, {'@type':'PostalAddress', addressLocality:place['@id'].endsWith('#fen-burdett') ? 'North Vancouver' : 'Vancouver', addressRegion:'BC', addressCountry:'CA'});
      for (const property of ['geo', 'openingHours', 'openingHoursSpecification', 'telephone', 'owner', 'branchCode']) assert(!(property in place), file + ': unsupported public venue ' + property);
      assert.match(built['locations.html'], new RegExp('id="' + new URL(place['@id']).hash.slice(1) + '"'), 'Venue ID must match an existing visible location anchor');
    }
  }
  assert.deepEqual(node('locations.html', 'WebPage').mainEntity.map(item => item['@id']), expectedIds);
});

test('no FAQ rich-result, rating, storefront or unverified credential claims are introduced', () => {
  const forbiddenTypes = new Set(['FAQPage', 'Question', 'Answer', 'Review', 'AggregateRating', 'LocalBusiness', 'SportsActivityLocation', 'Event', 'EducationalOccupationalCredential', 'Certification']);
  for (const file of pages) walk(graph(built[file]), item => {
    for (const type of [].concat(item['@type'] || [])) assert(!forbiddenTypes.has(type), file + ': unsupported ' + type);
    for (const property of ['aggregateRating', 'review', 'hasCredential', 'hasCertification']) assert(!(property in item), file + ': unsupported ' + property);
  });
});

test('shared logo keeps its real asset and SVG dimensions on every graph', () => {
  const svg = fs.readFileSync(path.join(root, 'logo-star-soccer-minimalized.svg'), 'utf8').match(/<svg\b[^>]*>/)[0];
  const width = Number(svg.match(/\bwidth="([^"]+)"/)[1]);
  const height = Number(svg.match(/\bheight="([^"]+)"/)[1]);
  for (const file of pages) assert.deepEqual(node(file, 'SportsOrganization').logo,
    {'@type':'ImageObject', url:origin + '/logo-star-soccer-minimalized.svg', width, height}, file);
});

test('current HTML metadata controls page name/description and cannot close the JSON-LD script', () => {
  const altered = {...sources, 'programs.html':sources['programs.html']
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>Training &amp; confidence &#8212; &lt;/script&gt;</title>')
    .replace(/<meta\b[^>]*name="description"[^>]*>/i, '<meta content="Current parent &amp; player details." name="description">')};
  const result = buildSearchData(altered)['programs.html'];
  const page = graph(result).find(item => item['@type'] === 'WebPage');
  assert.equal(page.name, 'Training & confidence — </script>');
  assert.equal(page.description, 'Current parent & player details.');
  assert(result.includes('\\u003c/script>'), 'HTML-sensitive JSON-LD text must stay inside its script');
  assert.equal(stripData(result), stripData(altered['programs.html']));
});
