(() => {
  const section = document.querySelector('#football-news');
  if (!section) return;

  const tabs = [...section.querySelectorAll('[role="tab"]')];
  const status = section.querySelector('[data-news-status]');
  const dayFormat = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const timeFormat = new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Vancouver'
  });
  const scoreText = (home, away) => home + '–' + away;

  function select(tab) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    }
  }

  function makeItem(title, details, label, url) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    const meta = document.createElement('span');
    link.textContent = title;
    link.href = url;
    meta.textContent = details + ' · ' + label;
    item.append(link, meta);
    return item;
  }

  function scoreDetails(game) {
    return game.competition + ' · ' + dayFormat.format(new Date(game.date + 'T00:00:00Z'));
  }

  function show(panel, items) {
    if (items.length) panel.querySelector('ul').replaceChildren(...items);
    else panel.querySelector('ul').replaceChildren();
    panel.querySelector('[data-news-empty]').hidden = items.length > 0;
  }

  function render(payload) {
    if (payload.version !== 1) throw new Error('Unsupported football news feed');
    const sources = Object.values(payload.sources);
    const cutoff = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const games = sources.filter(source => source.kind === 'results')
      .flatMap(source => source.items.filter(game => game.date >= cutoff))
      .sort((left, right) => right.date.localeCompare(left.date));
    const awards = sources.filter(source => source.kind === 'awards').flatMap(source => source.items);
    const highlighted = sources.filter(source => source.kind === 'results' && source.items.length)
      .map(source => source.items[0]).filter(game => game.date >= cutoff)
      .sort((left, right) => right.date.localeCompare(left.date)).slice(0, 6);

    show(section.querySelector('#football-results'), games.map(game =>
      makeItem(game.home + ' ' + scoreText(...game.goals) + ' ' + game.away,
        scoreDetails(game), game.source, game.url)));
    show(section.querySelector('#football-awards'), awards.map(award =>
      makeItem(award.winner, award.year + ' ' + award.name, award.source + ' · UEFA award archive', award.url)));
    show(section.querySelector('#football-headlines'), highlighted.map(game => {
      const [home, away] = game.goals;
      const title = home === away
        ? game.home + ' and ' + game.away + ' draw ' + scoreText(home, away)
        : home > away
          ? game.home + ' beat ' + game.away + ' ' + scoreText(home, away)
          : game.away + ' beat ' + game.home + ' ' + scoreText(away, home);
      return makeItem(title, scoreDetails(game), game.source, game.url);
    }));
    const last = sources.map(source => source.checkedAt).sort().at(-1);
    status.textContent = last ? 'Feed checked ' + timeFormat.format(new Date(last)) + ' Vancouver time' : 'Feed unavailable';
  }

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const nextIndex = {
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        ArrowRight: (index + 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1
      }[event.key];
      if (nextIndex === undefined) return;
      event.preventDefault();
      select(tabs[nextIndex]);
      tabs[nextIndex].focus();
    });
  }

  fetch('football-news.json')
    .then(response => {
      if (!response.ok) throw new Error('Football news feed unavailable');
      return response.json();
    })
    .then(render)
    .catch(() => { status.textContent = 'Football news is temporarily unavailable.'; });
})();
