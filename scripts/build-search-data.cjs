/* Refresh only JSON-LD from current HTML metadata and the public program catalogs.
 * Run after copy edits: node scripts/build-search-data.cjs
 * Read-only drift check: node scripts/build-search-data.cjs --check
 */
const fs = require('node:fs');
const path = require('node:path');
const training = require('../training.js').catalog;
const winter = require('../winter-camps.js').catalog;
const origin = 'https://starsoccer.ca';
const organizationId = origin + '/#organization';
const websiteId = origin + '/#website';
const clone = value => JSON.parse(JSON.stringify(value));
const ref = id => ({'@id': id});

function decode(value) {
  const names = {amp:'&', quot:'"', apos:"'", lt:'<', gt:'>', nbsp:'\u00a0', ndash:'–', mdash:'—', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”'};
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] !== '#') return names[entity.toLowerCase()] ?? whole;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map(([, key, double, single]) => [key.toLowerCase(), decode(double ?? single)]));
}

function parsePage(source, file) {
  if (/<body\b[^>]*\bdata-redirect\s*=/i.test(source)) return null;
  const scripts = [...source.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi)]
    .filter(match => attributes(match[1]).type?.toLowerCase() === 'application/ld+json');
  if (!scripts.length) return null;
  if (scripts.length !== 1) throw new Error(file + ': expected one JSON-LD graph');
  const graph = JSON.parse(scripts[0][2])['@graph'];
  if (!Array.isArray(graph)) throw new Error(file + ': expected an existing @graph');
  const links = [...source.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0]));
  const canonical = links.find(tag => tag.rel?.toLowerCase().split(/\s+/).includes('canonical'))?.href;
  const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  const description = [...source.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0]))
    .find(tag => tag.name?.toLowerCase() === 'description')?.content;
  if (!canonical || !title || !description) throw new Error(file + ': canonical, title and description are required');
  const url = new URL(canonical);
  if (url.origin !== origin || url.search || url.hash) throw new Error(file + ': expected a clean Star Soccer canonical URL');
  for (const type of ['SportsOrganization', 'WebSite', 'WebPage']) {
    if (graph.filter(node => node['@type'] === type).length !== 1) throw new Error(file + ': expected one ' + type);
  }
  return {source, file, graph, script: scripts[0], canonical, title: decode(title).replace(/\s+/g, ' ').trim(), description};
}

function publicPlaces(home) {
  const organization = home.graph.find(node => node['@type'] === 'SportsOrganization');
  const locations = organization.location || [];
  return Object.entries(training.locations).map(([key, catalogLocation]) => {
    const id = origin + '/locations.html#' + key;
    const source = locations.map(location => location.name ? location : home.graph.find(node => node['@id'] === location['@id']))
      .find(location => location?.name === catalogLocation.name);
    if (!source || source.address?.addressLocality !== 'Vancouver' || source.address.addressRegion !== 'BC' || source.address.addressCountry !== 'CA') {
      throw new Error('Expected the existing public Vancouver venue: ' + catalogLocation.name);
    }
    // These are public training venues, not a business address or an owned branch.
    return {'@type':'Place', '@id':id, name:source.name, url:id,
      address:{'@type':'PostalAddress', addressLocality:source.address.addressLocality,
        addressRegion:source.address.addressRegion, addressCountry:source.address.addressCountry}};
  });
}

function serviceFor(page, organization, places) {
  const base = {'@type':'Service', provider:ref(organizationId), areaServed:clone(organization.areaServed),
    url:page.canonical, description:page.description, mainEntityOfPage:ref(page.canonical + '#webpage')};
  const channel = key => {
    const place = places.find(item => item['@id'] === origin + '/locations.html#' + key);
    if (!place) throw new Error('No approved public venue for ' + key);
    return {'@type':'ServiceChannel', serviceLocation:ref(place['@id']),
      serviceUrl:page.canonical + (page.file === 'programs.html' ? '?location=' + key + '#sessions' : '')};
  };
  if (page.file === 'programs.html') {
    const sessions = training.sessions.filter(session => session.active);
    const minAge = Math.min(...sessions.map(session => session.minAge));
    const maxAge = Math.max(...sessions.map(session => session.maxAge));
    return {...base, '@id':page.canonical + '#weekly-training', name:'Weekly soccer training in Vancouver',
      serviceType:'Youth soccer training', audience:{'@type':'PeopleAudience', suggestedMinAge:minAge, suggestedMaxAge:maxAge},
      availableChannel:[...new Set(sessions.map(session => session.location))].map(channel)};
  }
  if (page.file === 'program-private-small-group.html') {
    // A private venue and appointment are arranged after inquiry; do not imply a fixed site.
    return {...base, '@id':page.canonical + '#private-coaching', name:'Private soccer coaching in Vancouver',
      serviceType:'Private and small-group soccer coaching'};
  }
  if (page.file === 'camps.html') {
    const key = Object.keys(training.locations).find(key => training.locations[key].name === winter.location);
    return {...base, '@id':page.canonical + '#winter-camps', name:'Winter soccer camps in Vancouver',
      serviceType:'Youth winter soccer camps', audience:{'@type':'PeopleAudience', suggestedMinAge:winter.minAge, suggestedMaxAge:winter.maxAge},
      availableChannel:[channel(key)]};
  }
  return null;
}

function buildSearchData(sources) {
  const pages = Object.entries(sources).map(([file, source]) => parsePage(source, file)).filter(Boolean);
  const home = pages.find(page => page.file === 'index.html');
  if (!home) throw new Error('index.html with its existing organization graph is required');
  const places = publicPlaces(home);
  const organization = clone(home.graph.find(node => node['@type'] === 'SportsOrganization'));
  const website = clone(home.graph.find(node => node['@type'] === 'WebSite'));
  if (organization['@id'] !== organizationId || website['@id'] !== websiteId) throw new Error('Keep the existing shared organization and website identities');
  if (organization.address) throw new Error('No verified organization address is supplied; public parks are training venues');
  if (organization.areaServed?.['@type'] !== 'City' || organization.areaServed.name !== 'Vancouver') throw new Error('Expected the existing Vancouver service area');
  // Coaching since 2000 does not independently establish the organization's founding year.
  delete organization.foundingDate;
  organization.location = places.map(place => ref(place['@id']));
  const result = {...sources};
  for (const page of pages) {
    const webpage = clone(page.graph.find(node => node['@type'] === 'WebPage'));
    webpage['@id'] = page.canonical + '#webpage';
    webpage.url = page.canonical;
    webpage.name = page.title;
    webpage.description = page.description;
    webpage.isPartOf = ref(websiteId);
    webpage.about = ref(organizationId);
    delete webpage.mainEntity;
    const service = serviceFor(page, organization, places);
    if (service) webpage.mainEntity = ref(service['@id']);
    else if (page.file === 'locations.html') webpage.mainEntity = places.map(place => ref(place['@id']));
    const graph = [clone(organization), clone(website), webpage, ...clone(places)];
    if (service) graph.push(service);
    const data = JSON.stringify({'@context':'https://schema.org', '@graph':graph}).replace(/</g, '\\u003c');
    const script = page.script;
    result[page.file] = page.source.slice(0, script.index) + script[1] + data + script[3] + page.source.slice(script.index + script[0].length);
  }
  return result;
}

function readSources(root) {
  return Object.fromEntries(fs.readdirSync(root).filter(file => file.endsWith('.html'))
    .map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
}

if (require.main === module) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/build-search-data.cjs [--check]');
    const root = path.resolve(__dirname, '..');
    const sources = readSources(root);
    const result = buildSearchData(sources);
    const changed = Object.keys(result).filter(file => result[file] !== sources[file]);
    if (process.argv.includes('--check')) {
      if (changed.length) throw new Error('JSON-LD needs rebuilding: ' + changed.join(', '));
      console.log('JSON-LD matches current metadata and public services.');
    } else {
      for (const file of changed) fs.writeFileSync(path.join(root, file), result[file]);
      console.log('Updated JSON-LD on ' + changed.length + ' pages' + (changed.length ? ': ' + changed.join(', ') : '') + '.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {buildSearchData, readSources};
