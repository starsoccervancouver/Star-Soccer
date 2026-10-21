"""Dependency-free release checks: local links, IDs, closed camps and catalog/UI parity."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlparse, unquote, parse_qs
import collections, json, subprocess
ROOT=Path(__file__).resolve().parents[1]
class Page(HTMLParser):
    def __init__(self,path):
        super().__init__();self.ids=[];self.links=[];self.tags=[];self.path=path;self.feed(path.read_text())
    def handle_starttag(self,tag,attrs):
        a=dict(attrs);self.tags.append((tag,a))
        if 'id' in a:self.ids.append(a['id'])
        for key in ['href','src','action']:
            if key in a:self.links.append((key,a[key]))
HTML_FILES=[*ROOT.glob('*.html'),*(ROOT/'Star soccer').glob('*.html')]
PAGES={p.relative_to(ROOT).as_posix():Page(p) for p in HTML_FILES}
errors=[];link_count=0
for name,p in PAGES.items():
    for id,count in collections.Counter(p.ids).items():
        if count>1:errors.append(f'{name}: duplicate id {id}')
    for key,link in p.links:
        u=urlparse(link)
        if u.scheme or u.netloc:continue
        path=(p.path.parent/unquote(u.path)).resolve() if u.path else p.path
        if path.is_dir():path=path/'index.html'
        if not path.exists():errors.append(f'{name}: missing {link}')
        elif key=='href' and u.fragment and path.suffix=='.html':
            target=PAGES.get(path.relative_to(ROOT).as_posix())
            if target and unquote(u.fragment) not in target.ids:errors.append(f'{name}: missing anchor {link}')
        link_count+=1
    if Path(name).name.startswith('camp-'):
        if any('registration.html' in link for _,link in p.links):errors.append(f'{name}: old camp still links to registration')
        if any(tag=='form' for tag,a in p.tags):errors.append(f'{name}: retired camp form still present')
    if 'data-redirect' not in p.path.read_text():
        for asset in ['site-ux.js','site.min.css']:
            if not any(asset in link for _,link in p.links):errors.append(f'{name}: missing shared {asset}')
catalog=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./training.js').catalog))"],cwd=ROOT,text=True))
schedule=PAGES['programs.html'];links=[urlparse(link) for _,link in schedule.links if link.startswith('registration.html?')]
expected={(s['id'],typ) for s in catalog['sessions'] if s['active'] for typ in ['dropin','pass4']}
actual={(parse_qs(u.query).get('sessionId',[''])[0],parse_qs(u.query).get('type',[''])[0]) for u in links}
if actual!=expected:errors.append('Programs registration links do not match the catalog')
for s in catalog['sessions']:
    rows=[a for tag,a in schedule.tags if a.get('data-session-day')==s['id']]
    if len(rows)!=1 or rows[0].get('data-min-age')!=str(s['minAge']) or rows[0].get('data-max-age')!=str(s['maxAge']) or rows[0].get('data-session-location')!=s['location']:errors.append('Catalog age/location mismatch '+s['id'])
print(f'Checked {len(PAGES)} HTML pages, {link_count} local references, catalog links and retired camps.')
if errors:
    print('\n'.join(errors));raise SystemExit(1)
print('All static checks passed.')
