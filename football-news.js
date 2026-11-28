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
  const featuredMatches = {
    '2026-11-21|1. FC Union Berlin|RB Leipzig': {
      youtubeId: 'TIeusIZuHr4'
    },
    '2026-11-22|Barcelona|Villarreal': {
      title: 'Barça come from two down to beat Villarreal 3–2',
      summary: 'Barcelona trailed 2–0 at half-time, then scored three after the break at Camp Nou.',
      report: 'https://www.fcbarcelona.com/en/football/first-team/news/4612696/bara-32-villarreal-heroic-response',
      youtubeId: 'ldXZdhBLMKk',
      lead: true
    },
    '2026-11-22|Vancouver Whitecaps|Real Salt Lake': {
      title: 'Whitecaps open the playoffs with a 2–0 win',
      summary: 'Vancouver beat Real Salt Lake at BC Place in Game 1 of the first round.',
      report: 'https://www.mlssoccer.com/playoffs/2026/news/vancouver-whitecaps-open-playoffs-in-style-with-victory-over-real-salt-lake',
      youtubeId: '3EdK_3n6eGE'
    },
    '2026-11-22|Atalanta|Inter Milan': {
      title: 'Atalanta rescue a 4–4 draw against Inter',
      report: 'https://en.atalanta.it/news/never-say-die-atalanta-fight-back-to-draw-4-4-with-inter',
      youtubeId: '91CeztXQwPM'
    },
    '2026-11-22|Liverpool|Manchester United': {
      title: 'Liverpool put four past Manchester United',
      youtubeId: '9bLh_lq4SrI'
    },
    '2026-11-22|SV Werder Bremen|Hamburger SV': {
      title: 'Werder Bremen win the Nordderby 4–0',
      youtubeId: 'AjoE-9Br7bk'
    },
    '2026-11-16|Canada|Guatemala': {
      title: 'Canada beat Guatemala 4–1 to reach the finals',
      report: 'https://canadasoccer.com/match/6748/',
      youtubeId: '9uiaqoX0Pys'
    },
    '2026-11-17|Wales|Portugal': {
      title: 'Portugal edge Wales 3–2 in Cardiff',
      youtubeId: 'LStoYhX0z5k'
    }
  };

  const priorityCategories = ['premier-league', 'champions-league', 'canada', 'whitecaps'];
  const topFlight = {
    'premier-league': ['Arsenal', 'Chelsea', 'Liverpool', 'Manchester City', 'Manchester United', 'Tottenham'],
    'champions-league': ['Barcelona', 'Real Madrid', 'Bayern', 'Liverpool', 'Arsenal', 'Paris Saint-Germain', 'Manchester City', 'Inter', 'Juventus'],
    'la-liga': ['Barcelona', 'Real Madrid', 'Atlético Madrid', 'Villarreal', 'Athletic Bilbao', 'Real Betis'],
    bundesliga: ['Bayern', 'Borussia Dortmund', 'RB Leipzig', 'Bayer Leverkusen', 'Eintracht Frankfurt'],
    'serie-a': ['Inter', 'Juventus', 'AC Milan', 'Napoli', 'Roma', 'Atalanta'],
    'ligue-1': ['Paris SG', 'Paris Saint-Germain', 'Marseille', 'Monaco', 'Lyon', 'Lille']
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
    const youtubeId = known?.youtubeId ?? game.youtubeId;

    const teams = [game.home, game.away];
    const majorClubs = topFlight[key] ?? [];
    const bigTeams = teams.filter(team => majorClubs.some(club => team.includes(club))).length;
    const goals = game.goals[0] + game.goals[1];
    const barcelona = teams.some(team => /(^| )Barcelona$/.test(team));
    const interest = bigTeams * 2 + Math.min(goals, 7) + (barcelona ? 4 : 0);

    return {
      category, date: game.date, competition: key === 'whitecaps' ? 'MLS' : game.competition.split(' · ')[0],
      title: known?.title ?? matchHeadline(game),
      summary: known?.summary,
      report: known?.report ?? game.url,
      youtubeId: /^[A-Za-z0-9_-]{11}$/.test(youtubeId ?? '') ? youtubeId : null,
      highlightUrl: key === 'champions-league' &&
        /^https:\/\/www\.uefa\.com\/(?:news-media\/video|uefachampionsleague\/video(?:\/highlights)?)\/[a-z0-9-]+\/$/.test(game.highlightUrl ?? '')
        ? game.highlightUrl : null,
      eventPhoto: game.eventPhoto,
      lead: Boolean(known?.lead),
      interest: known?.lead ? interest + 10 : interest,
      eligible: priorityCategories.includes(category) || category === 'international' ||
        Boolean(known) || barcelona || bigTeams === 2 || (bigTeams > 0 && goals >= 4)
    };
  }

  function awardStory(award) {
    return {
      category: 'awards', date: award.date, competition: award.name,
      title: award.winner + ' wins the ' + award.name, report: award.url, interest: 6, eligible: true
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
    const figure = photo.closest('figure');
    if (story.youtubeId || /^https:\/\/(?:www\.)?thesportsdb\.com\/images\/media\/event\//.test(story.eventPhoto ?? '')) {
      photo.addEventListener('error', () => figure.remove(), { once: true });
      photo.src = story.youtubeId ? 'https://i.ytimg.com/vi/' + story.youtubeId + '/hqdefault.jpg' : story.eventPhoto;
      photo.alt = story.youtubeId ? 'Highlight video preview: ' + story.title : story.title;
    } else figure.remove();
    if (story.summary) {
      summary.textContent = story.summary;
      summary.hidden = false;
    }
    if (story.highlightUrl) {
      video.href = story.highlightUrl;
      video.querySelector('[data-story-video-label]').textContent = 'Watch on UEFA';
      video.setAttribute('aria-label', 'Watch highlights on UEFA: ' + story.title);
      video.hidden = false;
    } else if (story.youtubeId) {
      video.href = 'https://www.youtube.com/watch?v=' + story.youtubeId;
      video.querySelector('[data-story-video-label]').textContent = 'Watch on YouTube';
      video.setAttribute('aria-label', 'Watch highlights on YouTube: ' + story.title);
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
    const editorialOrder = (left, right) =>
      Number(Boolean(right.lead)) - Number(Boolean(left.lead)) ||
      right.interest - left.interest || right.date.localeCompare(left.date);
    const selected = new Map();
    for (const story of stories.filter(story => story.eligible).sort(editorialOrder)) {
      if (!selected.has(story.category)) selected.set(story.category, story);
    }
    const core = priorityCategories.map(category => selected.get(category)).filter(Boolean);
    const extras = [...selected.values()].filter(story => !priorityCategories.includes(story.category));
    const storiesToShow = [...core, ...extras].slice(0, 5).sort(editorialOrder);
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
