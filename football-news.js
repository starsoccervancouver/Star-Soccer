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
      score: [1, 5],
      youtubeId: 'TIeusIZuHr4'
    },
    '2026-11-22|Barcelona|Villarreal': {
      score: [3, 2],
      title: 'Barça come from two down to beat Villarreal 3–2',
      summary: 'Barcelona trailed 2–0 at half-time, then scored three after the break at Camp Nou.',
      report: 'https://www.fcbarcelona.com/en/football/first-team/news/4612696/bara-32-villarreal-heroic-response',
      youtubeId: 'ldXZdhBLMKk',
      lead: true
    },
    '2026-11-22|Vancouver Whitecaps|Real Salt Lake': {
      score: [2, 0],
      title: 'Whitecaps open the playoffs with a 2–0 win',
      summary: 'Vancouver beat Real Salt Lake at BC Place in Game 1 of the first round.',
      report: 'https://www.mlssoccer.com/playoffs/2026/news/vancouver-whitecaps-open-playoffs-in-style-with-victory-over-real-salt-lake',
      youtubeId: '3EdK_3n6eGE'
    },
    '2026-11-22|Atalanta|Inter Milan': {
      score: [4, 4],
      title: 'Atalanta rescue a 4–4 draw against Inter',
      report: 'https://en.atalanta.it/news/never-say-die-atalanta-fight-back-to-draw-4-4-with-inter',
      youtubeId: '91CeztXQwPM'
    },
    '2026-11-22|Liverpool|Manchester United': {
      score: [4, 0],
      title: 'Liverpool put four past Manchester United',
      youtubeId: '9bLh_lq4SrI'
    },
    '2026-11-22|SV Werder Bremen|Hamburger SV': {
      score: [4, 0],
      title: 'Werder Bremen win the Nordderby 4–0',
      youtubeId: 'AjoE-9Br7bk'
    },
    '2026-11-16|Canada|Guatemala': {
      score: [4, 1],
      title: 'Canada beat Guatemala 4–1 to reach the finals',
      report: 'https://canadasoccer.com/match/6748/',
      youtubeId: '9uiaqoX0Pys'
    },
    '2026-11-17|Wales|Portugal': {
      score: [2, 3],
      title: 'Portugal edge Wales 3–2 in Cardiff',
      youtubeId: 'LStoYhX0z5k'
    }
  };

  const europeanCompetitions = new Set([
    'champions-league', 'premier-league', 'la-liga', 'serie-a', 'bundesliga', 'ligue-1'
  ]);
  const majorClubs = new Set([
    'barcelona', 'real madrid', 'atletico madrid', 'villarreal',
    'liverpool', 'manchester united', 'manchester city', 'arsenal', 'chelsea', 'tottenham',
    'bayern munchen', 'borussia dortmund', 'leipzig', 'bayer leverkusen',
    'inter', 'milan', 'juventus', 'napoli', 'roma', 'atalanta',
    'paris saint germain', 'marseille', 'monaco', 'lyon'
  ]);
  const teamAliases = {
    'barca': 'barcelona',
    'atleti': 'atletico madrid',
    'atletico de madrid': 'atletico madrid',
    'man utd': 'manchester united',
    'man united': 'manchester united',
    'manchester utd': 'manchester united',
    'man city': 'manchester city',
    'tottenham hotspur': 'tottenham',
    'inter milan': 'inter',
    'inter mailand': 'inter',
    'internazionale': 'inter',
    'internazionale milano': 'inter',
    'bayern munich': 'bayern munchen',
    'bayern': 'bayern munchen',
    'bayer 04 leverkusen': 'bayer leverkusen',
    'como 1907': 'como',
    'mailand': 'milan',
    'rasenballsport leipzig': 'leipzig',
    'athletic': 'athletic bilbao',
    'b dortmund': 'borussia dortmund',
    'paris st germain': 'paris saint germain',
    'paris sg': 'paris saint germain',
    'olympique marseille': 'marseille',
    'olympique lyonnais': 'lyon',
    'psg': 'paris saint germain',
    'slavia prag': 'slavia praha',
    'slavia prague': 'slavia praha',
    's bratislava': 'slovan bratislava',
    'galatasaray istanbul': 'galatasaray',
    'feyenoord rotterdam': 'feyenoord',
    'rom': 'roma',
    'hamburger': 'hamburg',
    '1 fsv mainz 05': 'mainz'
  };

  function teamKey(name) {
    const words = name.toLowerCase().replace(/ø/g, 'o').replace(/ł/g, 'l')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
    if (words === 'paris fc' || words === 'fc paris') return 'paris fc';
    const normalized = words.split(' ')
      .filter(word => !['fc', 'cf', 'afc', 'ac', 'as', 'sc', 'sk', 'fk', 'vfb', 'ssc', 'osc', 'kv', 'club', 'sv', 'rb', 'rc'].includes(word))
      .join(' ');
    return teamAliases[normalized] ?? normalized;
  }

  function displayTeam(name) {
    const displayNames = {
      'barcelona': 'Barcelona', 'atletico madrid': 'Atlético Madrid',
      'manchester united': 'Manchester United', 'manchester city': 'Manchester City',
      'bayern munchen': 'Bayern Munich', 'borussia dortmund': 'Borussia Dortmund',
      'paris saint germain': 'Paris Saint-Germain', 'roma': 'Roma', 'inter': 'Inter Milan', 'napoli': 'Napoli',
      'milan': 'AC Milan', 'brugge': 'Club Brugge', 'bodo glimt': 'Bodø/Glimt'
    };
    return displayNames[teamKey(name)] ?? name;
  }

  function matchHeadline(game) {
    const [home, away] = game.goals;
    const homeTeam = displayTeam(game.home), awayTeam = displayTeam(game.away);
    if (home === away) return homeTeam + ' and ' + awayTeam + ' draw ' + home + '–' + away;
    if (home > away) return homeTeam + ' beat ' + awayTeam + ' ' + home + '–' + away;
    return awayTeam + ' beat ' + homeTeam + ' ' + away + '–' + home;
  }

  function espnImage(url) {
    try {
      const image = new URL(url);
      return image.protocol === 'https:' && !image.username && !image.password &&
        ['espnmedia-cdn.akamaized.net', 'a.espncdn.com'].includes(image.hostname);
    } catch {
      return false;
    }
  }

  function videoOptions(key, game, known) {
    const options = [];
    const uefa = /^https:\/\/www\.uefa\.com\/(?:news-media\/video|uefachampionsleague\/video(?:\/highlights)?)\/[a-z0-9-]+\/$/;
    const uefaImage = /^https:\/\/editorial\.uefa\.com\/resources\/[0-9a-f-]+\/format\/wide1\/[A-Za-z0-9_.-]+$/;
    if (key === 'champions-league' && uefa.test(game.highlightUrl ?? '') &&
        uefaImage.test(game.highlightThumbnail ?? '')) {
      options.push({url: game.highlightUrl, image: game.highlightThumbnail, source: 'UEFA', kind: 'highlights'});
    }

    function addYouTube(id) {
      if (/^[A-Za-z0-9_-]{11}$/.test(id ?? '') && !options.some(option => option.id === id)) {
        options.push({id, url: 'https://www.youtube.com/watch?v=' + id,
          image: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', source: 'YouTube', kind: 'highlights'});
      }
    }
    addYouTube(known?.youtubeId);

    const espnVideo = /^https:\/\/www\.espn\.com\/video\/clip\/_\/id\/\d+(?:\/[A-Za-z0-9-]+)?\/?$/;
    const expiry = game.espnExpiresAt;
    const espnAvailable = !expiry || (!Number.isNaN(Date.parse(expiry)) && Date.parse(expiry) > Date.now());
    const espn = espnAvailable && espnVideo.test(game.espnVideoUrl ?? '') && espnImage(game.espnThumbnail) &&
      ['highlights', 'moment'].includes(game.espnVideoKind)
      ? {url: game.espnVideoUrl, image: game.espnThumbnail, source: 'ESPN', kind: game.espnVideoKind} : null;
    if (espn?.kind === 'highlights') options.push(espn);
    addYouTube(game.youtubeId);
    if (espn?.kind === 'moment') options.push(espn);
    return options;
  }

  function matchStory(key, game) {
    const entry = featuredMatches[[game.date, game.home, game.away].join('|')];
    const known = entry && (!entry.score || entry.score.every((goal, index) => goal === game.goals[index]))
      ? entry : null;
    const teams = [teamKey(game.home), teamKey(game.away)];
    const bigTeams = teams.filter(team => majorClubs.has(team)).length;
    const competitionWeight = {'champions-league': 4, 'premier-league': 3, 'la-liga': 3,
      'serie-a': 2, bundesliga: 2, 'ligue-1': 1};
    const interest = bigTeams * 10 + (bigTeams === 2 ? 5 : 0) +
      (competitionWeight[key] ?? 0) + Math.min(game.goals[0] + game.goals[1], 6) +
      (known?.lead ? 1 : 0);
    return {
      id: [key, game.date, game.home, game.away, ...game.goals].join('|'),
      category: key,
      date: game.date,
      teams,
      barcelona: teams.includes('barcelona'),
      competition: key === 'whitecaps' ? 'MLS' : game.competition.split(' · ')[0],
      title: known?.title ?? matchHeadline(game),
      summary: known?.summary,
      report: known?.report ?? game.url,
      media: videoOptions(key, game, known),
      interest
    };
  }

  function rank(left, right) {
    return right.interest - left.interest || right.date.localeCompare(left.date);
  }

  function canAdd(story, selected) {
    return story && story.teams.every(team => team && !selected.some(item => item.teams.includes(team)));
  }

  function selectStories(stories) {
    const selected = [];
    const add = story => { if (canAdd(story, selected)) selected.push(story); };
    const whitecaps = stories.filter(story => story.category === 'whitecaps')
      .sort((left, right) => right.date.localeCompare(left.date) || rank(left, right));
    add(whitecaps[0]);

    const barcelona = stories.filter(story => story.barcelona && canAdd(story, selected)).sort(rank);
    const champions = stories.filter(story => story.category === 'champions-league' && canAdd(story, selected)).sort(rank);
    let pair;
    for (const barca of barcelona) {
      const other = champions.find(story => story.id !== barca.id && canAdd(story, [...selected, barca]));
      if (other) { pair = [barca, other]; break; }
    }
    if (pair) {
      pair.forEach(add);
    } else {
      add(barcelona.find(story => story.category === 'champions-league') ?? barcelona[0]);
      if (!selected.some(story => story.category === 'champions-league')) {
        add(champions.find(story => canAdd(story, selected)));
      }
    }
    for (const story of stories.filter(story => europeanCompetitions.has(story.category)).sort(rank)) {
      if (selected.length >= 5) break;
      add(story);
    }
    return selected;
  }

  function renderCard(story, unavailable) {
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
    if (story.summary) {
      summary.textContent = story.summary;
      summary.hidden = false;
    }

    let mediaIndex = 0;
    function showMedia() {
      const media = story.media[mediaIndex];
      if (!media) {
        if (card.isConnected) unavailable(story);
        return;
      }
      photo.alt = 'Video preview for ' + story.title;
      photo.src = media.image;
      const label = media.kind === 'moment' ? 'Watch key moment' : 'Watch highlights';
      video.href = media.url;
      video.querySelector('[data-story-video-label]').textContent = (media.kind === 'moment' ? 'Key moment' : 'Highlights') + ' · ' + media.source;
      video.setAttribute('aria-label', label + ' on ' + media.source + ': ' + story.title);
      video.hidden = false;
    }
    photo.addEventListener('error', () => { mediaIndex += 1; showMedia(); });
    showMedia();
    return card;
  }

  function render(payload) {
    if (payload.version !== 1) throw new Error('Unsupported football news feed');
    const sources = Object.entries(payload.sources);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: vancouver }).format(new Date());
    const firstDay = new Date(Date.parse(today) - 6 * 86400000).toISOString().slice(0, 10);
    const stories = sources
      .filter(([key, source]) => source.kind === 'results' && (key === 'whitecaps' || europeanCompetitions.has(key)))
      .flatMap(([key, source]) => source.items
        .filter(item => item.date >= firstDay && item.date <= today)
        .map(item => matchStory(key, item)))
      .filter(story => story.media.length);
    const unavailable = new Set();

    function draw() {
      const selected = selectStories(stories.filter(story => !unavailable.has(story.id)));
      const cards = selected.map(story => renderCard(story, failed => {
        unavailable.add(failed.id);
        draw();
      }));
      grid.replaceChildren(...cards);
      empty.hidden = cards.length > 0;
    }
    draw();
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
