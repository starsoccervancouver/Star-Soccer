(() => {
  const section = document.querySelector('#football-news');
  if (!section) return;

  const grid = section.querySelector('[data-football-stories]');
  const status = section.querySelector('[data-news-status]');
  const empty = section.querySelector('[data-news-empty]');
  const template = section.querySelector('template');
  const vancouver = 'America/Vancouver';
  const dayFormat = new Intl.DateTimeFormat('en-CA', {
    month: 'short', day: 'numeric', timeZone: 'UTC'
  });
  const timeFormat = new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: vancouver
  });
  const photos = {
    'Vancouver Whitecaps': ['bc-place', 'Archive photo of a Whitecaps match at BC Place'],
    Liverpool: ['anfield', 'Archive photo of the Kop at Anfield'],
    'SV Werder Bremen': ['bremen', 'Aerial photo of the Weserstadion in Bremen'],
    Canada: ['canada', 'Archive photo of Canada at BMO Field'],
    Wales: ['cardiff', 'Archive photo of Wales playing in Cardiff']
  };

  const featuredMatches = {
    '2026-11-22|Vancouver Whitecaps|Real Salt Lake': {
      title: 'Whitecaps open the playoffs with a 2–0 win',
      summary: 'Vancouver beat Real Salt Lake at BC Place in Game 1 of the first round.',
      report: 'https://www.mlssoccer.com/playoffs/2026/news/vancouver-whitecaps-open-playoffs-in-style-with-victory-over-real-salt-lake',
      video: 'https://www.whitecapsfc.com/video/highlights-vancouver-whitecaps-fc-vs-real-salt-lake-november-22-2026'
    },
    '2026-11-22|Liverpool|Manchester United': {
      title: 'Liverpool put four past Manchester United',
      video: 'https://www.liverpoolfc.com/news/liverpool-4-0-manchester-united-premier-league-highlights-watch'
    },
    '2026-11-22|SV Werder Bremen|Hamburger SV': {
      title: 'Werder Bremen win the Nordderby 4–0',
      video: 'https://www.bundesliga.com/en/bundesliga/news/werder-bremen-hamburg-match-report-highlights-matchday-10-40103'
    },
    '2026-11-16|Canada|Guatemala': {
      title: 'Canada beat Guatemala 4–1 to reach the finals',
      report: 'https://canadasoccer.com/match/6748/',
      video: 'https://www.concacaf.com/competitions/nations-league/videos/canada-vs-guatemala-highlights'
    },
    '2026-11-17|Wales|Portugal': {
      title: 'Portugal edge Wales 3–2 in Cardiff',
      video: 'https://www.uefa.com/uefanationsleague/news/02ab-22146db70e40-12d581ab82a9-1000--uefa-nations-league-matchday-6-highlights-erling-haaland-tak/'
    }
  };

  const videoHubs = {
    whitecaps: 'https://www.whitecapsfc.com/video/',
    'premier-league': 'https://www.premierleague.com/en/video',
    'champions-league': 'https://www.uefa.com/uefachampionsleague/video/',
    bundesliga: 'https://www.bundesliga.com/en/bundesliga/videos'
  };

  function matchHeadline(game) {
    const [home, away] = game.goals;
    if (home === away) return game.home + ' and ' + game.away + ' draw ' + home + '–' + away;
    if (home > away) return game.home + ' beat ' + game.away + ' ' + home + '–' + away;
    return game.away + ' beat ' + game.home + ' ' + away + '–' + home;
  }

  function matchStory(key, game) {
    const canada = key.startsWith('international-') && [game.home, game.away].includes('Canada');
    const category = key.startsWith('international-') ? (canada ? 'canada' : 'international') : key;
    const known = featuredMatches[[game.date, game.home, game.away].join('|')];
    let videoHub = videoHubs[key];
    if (game.competition.startsWith('UEFA Nations League')) {
      videoHub = 'https://www.uefa.com/uefanationsleague/video/';
    }
    if (game.competition.startsWith('CONCACAF Nations League')) {
      videoHub = 'https://www.concacaf.com/competitions/nations-league/videos';
    }

    return {
      category, date: game.date, competition: key === 'whitecaps' ? 'MLS' : game.competition.split(' · ')[0],
      title: known?.title ?? matchHeadline(game),
      summary: known?.summary,
      report: known?.report ?? game.url,
      photo: photos[game.home],
      video: known?.video ?? videoHub,
      exactVideo: Boolean(known?.video),
      margin: Math.abs(game.goals[0] - game.goals[1])
    };
  }

  function awardStory(award) {
    return {
      category: 'awards', date: award.date, competition: award.name,
      title: award.winner + ' wins the ' + award.name, report: award.url, margin: 0
    };
  }

  function renderCard(story) {
    const card = template.content.firstElementChild.cloneNode(true);
    const heading = card.querySelector('[data-story-title]');
    const photo = card.querySelector('img');
    const time = card.querySelector('time');
    const summary = card.querySelector('.football-story-summary');
    const video = card.querySelector('.football-story-video');
    heading.textContent = story.title;
    heading.href = story.report;
    card.querySelector('[data-story-competition]').textContent = story.competition;
    time.dateTime = story.date;
    time.textContent = dayFormat.format(new Date(story.date + 'T00:00:00Z'));
    photo.src = story.photo ? 'site-photos/football-news/' + story.photo[0] + '.webp' : 'winter-field-800.webp';
    photo.alt = story.photo?.[1] ?? 'Soccer pitch at Kitsilano Turf';
    if (story.summary) {
      summary.textContent = story.summary;
      summary.hidden = false;
    }
    if (story.video) {
      video.href = story.video;
      video.querySelector('[data-story-video-label]').textContent = story.exactVideo ? 'Watch highlights' : 'Browse highlights';
      video.setAttribute('aria-label', (story.exactVideo ? 'Watch highlights for ' : 'Browse highlights for ') + story.title);
      video.hidden = false;
    }
    return card;
  }

  function render(payload) {
    if (payload.version !== 1) throw new Error('Unsupported football news feed');
    const sources = Object.entries(payload.sources);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: vancouver }).format(new Date());
    const firstDay = new Date(Date.parse(today) - 6 * 86400000).toISOString().slice(0, 10);
    const recent = item => item.date >= firstDay && item.date <= today;
    const stories = sources.flatMap(([key, source]) => source.items.filter(recent).map(item =>
      source.kind === 'awards' ? awardStory(item) : matchStory(key, item)));
    stories.sort((left, right) => right.date.localeCompare(left.date) ||
      Number(right.category === 'whitecaps') - Number(left.category === 'whitecaps') ||
      Number(right.exactVideo ?? false) - Number(left.exactVideo ?? false) ||
      right.margin - left.margin);
    const selected = new Map();
    for (const story of stories) {
      if (!selected.has(story.category)) selected.set(story.category, story);
    }
    const storiesToShow = [...selected.values()].slice(0, 5);
    const recentAward = selected.get('awards');
    if (recentAward && !storiesToShow.includes(recentAward)) storiesToShow[4] = recentAward;
    const cards = storiesToShow.map(renderCard);
    grid.replaceChildren(...cards);
    empty.hidden = cards.length > 0;
    const last = sources.map(([, source]) => source.checkedAt).sort().at(-1);
    status.textContent = last ? 'Updated ' + timeFormat.format(new Date(last)) + ' Vancouver time' : 'Update unavailable';
  }

  fetch('football-news.json')
    .then(response => {
      if (!response.ok) throw new Error('Football news feed unavailable');
      return response.json();
    })
    .then(render)
    .catch(() => { status.textContent = 'Football news is temporarily unavailable.'; });
})();
