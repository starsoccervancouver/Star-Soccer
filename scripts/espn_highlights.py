"""Find match-specific ESPN videos and their own thumbnails when available in Canada."""
import json
import re
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from urllib.parse import urlencode, urlsplit
from zoneinfo import ZoneInfo

from uefa_highlights import UEFA_IMAGE, UEFA_URL, match_key, normalized_team

LEAGUES = {
    "whitecaps": "usa.1",
    "premier-league": "eng.1",
    "la-liga": "esp.1",
    "serie-a": "ita.1",
    "bundesliga": "ger.1",
    "ligue-1": "fra.1",
    "champions-league": "uefa.champions",
}
API = "https://site.api.espn.com/apis/site/v2/sports/soccer/"
VIDEO_URL = re.compile(r"https://www\.espn\.com/video/clip/_/id/\d+(?:/[A-Za-z0-9-]+)?/?")
IMAGE_HOSTS = {"espnmedia-cdn.akamaized.net", "a.espncdn.com"}
FULL_HIGHLIGHT = re.compile(r"\bhighlights?\b", re.IGNORECASE)
KEY_MOMENT = re.compile(r"\b(goal|scores?|scored|equalis\w*|equaliz\w*|winner|strike)\b", re.IGNORECASE)


def safe_image(url):
    if not isinstance(url, str):
        return False
    try:
        parsed = urlsplit(url)
        return (parsed.scheme == "https" and parsed.hostname in IMAGE_HOSTS
                and not parsed.username and not parsed.password)
    except ValueError:
        return False


def available_at(clip, now):
    restrictions = clip.get("geoRestrictions") or {}
    if not isinstance(restrictions, dict):
        return False
    mode = restrictions.get("type")
    countries = {str(country).upper() for country in restrictions.get("countries", [])}
    if (mode == "whitelist" and "CA" not in countries) or (mode == "blacklist" and "CA" in countries):
        return False
    if mode and mode not in {"whitelist", "blacklist"}:
        return False
    times = clip.get("timeRestrictions") or {}
    try:
        embargo = times.get("embargoDate")
        expiry = times.get("expirationDate")
        if embargo and datetime.fromisoformat(embargo.replace("Z", "+00:00")) > now:
            return False
        if expiry and datetime.fromisoformat(expiry.replace("Z", "+00:00")) <= now:
            return False
    except (ValueError, TypeError):
        return False
    return True


def searchable_words(value):
    """Normalize team abbreviations in a clip's headline and description."""
    words = normalized_team(value).split()
    for index, word in enumerate(words):
        if word == "barca":
            words[index] = "barcelona"
        elif word == "utd":
            words[index] = "united"
        elif word == "man" and index + 1 < len(words) and words[index + 1] in {"city", "utd", "united"}:
            words[index] = "manchester"
    return " " + " ".join(words) + " "


def mentions_team(text, names):
    return any(searchable_words(name) in text for name in names if name)


def clip_media(summary, event_id, now, home, away):
    if str(summary.get("header", {}).get("id", "")) != event_id:
        return None
    choices = []
    for clip in summary.get("videos", []):
        if not isinstance(clip, dict) or not available_at(clip, now):
            continue
        headline = clip.get("headline", "")
        description = clip.get("description") or ""
        if not isinstance(headline, str) or not isinstance(description, str):
            continue
        text = searchable_words(headline + " " + description)
        # ESPN may attach related clips to an event; require both teams to be
        # named so that the linked video and its thumbnail belong to this match.
        if not mentions_team(text, home) or not mentions_team(text, away):
            continue
        if FULL_HIGHLIGHT.search(headline):
            kind = "highlights"
        elif KEY_MOMENT.search(headline):
            kind = "moment"
        else:
            continue
        url = clip.get("links", {}).get("web", {}).get("href", "")
        image = clip.get("thumbnail", "")
        if not isinstance(url, str) or not VIDEO_URL.fullmatch(url) or not safe_image(image):
            continue
        expires = (clip.get("timeRestrictions") or {}).get("expirationDate", "")
        choices.append({
            "espnVideoUrl": url,
            "espnThumbnail": image,
            "espnVideoKind": kind,
            "espnExpiresAt": expires,
        })
    return next((item for item in choices if item["espnVideoKind"] == "highlights"),
                choices[0] if choices else None)


def team_names(team):
    return {normalized_team(team[key]) for key in ("displayName", "shortDisplayName", "name")
            if isinstance(team.get(key), str) and team[key]}


def event_candidate(event, league):
    if not event.get("status", {}).get("type", {}).get("completed"):
        return None
    event_id = str(event.get("id", ""))
    if not event_id.isdecimal():
        return None
    competitions = event.get("competitions", [])
    if len(competitions) != 1:
        return None
    sides = {side.get("homeAway"): side for side in competitions[0].get("competitors", [])}
    if set(sides) != {"home", "away"}:
        return None
    try:
        kickoff = datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
        zone = ZoneInfo("America/Vancouver" if league == "usa.1" else "Europe/Paris")
        day = kickoff.astimezone(zone).date().isoformat()
        goals = (int(sides["home"]["score"]), int(sides["away"]["score"]))
        home = team_names(sides["home"]["team"])
        away = team_names(sides["away"]["team"])
    except (KeyError, TypeError, ValueError):
        return None
    if not home or not away:
        return None
    return {"id": event_id, "date": day, "goals": goals, "home": home, "away": away}


def discover_highlights(sources, download, now=None):
    """Match a feed result to one completed ESPN event and its own video."""
    now = now or datetime.now(UTC)
    groups = defaultdict(list)
    for source, league in LEAGUES.items():
        for match in sources.get(source, {}).get("items", []):
            if match.get("espnVideoKind") == "highlights":
                continue
            uefa_url = match.get("highlightUrl", "")
            uefa_image = match.get("highlightThumbnail", "")
            if (isinstance(uefa_url, str) and UEFA_URL.fullmatch(uefa_url)
                    and isinstance(uefa_image, str) and UEFA_IMAGE.fullmatch(uefa_image)):
                continue
            priority_team = source == "whitecaps" or any(
                normalized_team(match[side]) == "barcelona" for side in ("home", "away")
            )
            youtube_id = match.get("youtubeId", "")
            if (isinstance(youtube_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{11}", youtube_id)
                    and not priority_team):
                continue
            groups[(league, match["date"])].append((source, match))
    if not groups:
        return {}

    def fetch_scoreboard(group):
        league, day = group
        dates = day.replace("-", "")
        url = API + league + "/scoreboard?" + urlencode({"dates": dates, "limit": 100})
        return json.loads(download(url)).get("events", [])

    matched = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_scoreboard, group): group for group in groups}
        for future in as_completed(futures):
            group = futures[future]
            try:
                events = [event_candidate(event, group[0]) for event in future.result()]
            except (OSError, ValueError, TypeError, KeyError) as error:
                print(f"ESPN scoreboard unavailable for {group[0]} on {group[1]}: {error}")
                continue
            events = [event for event in events if event]
            pairs = []
            for source, match in groups[group]:
                home = normalized_team(match["home"])
                away = normalized_team(match["away"])
                candidates = [event for event in events
                              if event["date"] == match["date"]
                              and event["goals"] == tuple(match["goals"])
                              and home and home in event["home"]
                              and away and away in event["away"]]
                if len(candidates) == 1:
                    pairs.append((source, match, candidates[0]))
            occurrences = Counter(event["id"] for _, _, event in pairs)
            matched.extend((source, match, event, group[0]) for source, match, event in pairs
                           if occurrences[event["id"]] == 1)

    def fetch_summary(league, event):
        url = API + league + "/summary?" + urlencode({"event": event["id"]})
        return clip_media(json.loads(download(url)), event["id"], now, event["home"], event["away"])

    results = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_summary, league, event): (source, match)
                   for source, match, event, league in matched}
        for future in as_completed(futures):
            source, match = futures[future]
            try:
                media = future.result()
            except (OSError, ValueError, TypeError, KeyError) as error:
                print(f"ESPN video unavailable for {source}: {error}")
                continue
            if media:
                results[(source, match_key(match))] = media
    return results
