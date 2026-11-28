"""Generate the homepage football feed using public scores and award records."""
import argparse
import csv
import io
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from threading import Lock
from time import monotonic, sleep
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from uefa_highlights import UEFA_IMAGE, UEFA_URL, discover_highlights, match_key
from espn_highlights import VIDEO_URL as ESPN_VIDEO_URL, safe_image as safe_espn_image
from espn_highlights import discover_highlights as discover_espn_highlights

TODAY = datetime.now(ZoneInfo("America/Vancouver")).date()
FIRST_DAY = (TODAY - timedelta(days=6)).isoformat()
AGENT = "StarSoccer.ca football news (https://starsoccer.ca/contact.html)"
DATA = "https://raw.githubusercontent.com/martj42/"
SPORTSDB = "https://www.thesportsdb.com/api/v1/json/123/"
SPORTSDB_LOCK = Lock()
sportsdb_next_request = 0.0
WIKIDATA = "https://www.wikidata.org/wiki/Special:EntityData/"
AWARD_ARCHIVE = "https://www.uefa.com/ballondor/"


def download(url):
    with urlopen(Request(url, headers={"User-Agent": AGENT}), timeout=12) as response:
        data = response.read(5_000_001)
    if len(data) > 5_000_000:
        raise ValueError("Feed exceeded the expected size")
    return data.decode("utf-8-sig")


def sportsdb(endpoint):
    global sportsdb_next_request
    with SPORTSDB_LOCK:
        sleep(max(0, sportsdb_next_request - monotonic()))
        for attempt in range(2):
            try:
                return json.loads(download(SPORTSDB + endpoint))
            except HTTPError as error:
                if error.code != 429 or attempt:
                    raise
                retry_after = error.headers.get("Retry-After", "")
                if retry_after.isdecimal() and int(retry_after) > 20:
                    raise
                sleep(int(retry_after) if retry_after.isdecimal() else 8)
            finally:
                sportsdb_next_request = monotonic() + 2.2


def score(home, away, home_goals, away_goals, day, competition, source, url):
    if not home or not away or home_goals in (None, "") or away_goals in (None, ""):
        return None
    goals = (int(home_goals), int(away_goals))
    if min(goals) < 0 or max(goals) > 99 or date.fromisoformat(day) > TODAY:
        return None
    return dict(home=home, away=away, goals=goals, date=day,
                competition=competition, source=source, url=url)


def european(shortcut, competition, results_url):
    year = TODAY.year - (TODAY.month < 7)
    url = f"https://api.openligadb.de/getmatchdata/{shortcut}/{year}"
    for match in json.loads(download(url)):
        if not match["matchIsFinished"]:
            continue
        final = next((result for result in match["matchResults"]
                      if result["resultTypeID"] == 2), None)
        if final:
            yield score(match["team1"]["teamName"], match["team2"]["teamName"],
                        final["pointsTeam1"], final["pointsTeam2"], match["matchDateTime"][:10],
                        competition, "OpenLigaDB", results_url)


def match_media(match):
    media = {}
    video = re.fullmatch(r"https://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/)([A-Za-z0-9_-]{11})(?:[&?][^#]*)?", match.get("strVideo") or "")
    if video:
        media["youtubeId"] = video[1]
    photo = match.get("strThumb") or ""
    if re.match(r"https://(?:www\.)?thesportsdb\.com/images/media/event/", photo):
        media["eventPhoto"] = photo
    return media


def sportsdb_league(identifier, provider_name, competition, results_url):
    latest = sportsdb(f"eventspastleague.php?id={identifier}").get("events") or []
    rounds = {(match["intRound"], match["strSeason"]) for match in latest
              if str(match.get("intRound", "")).isdigit() and match.get("strSeason")}
    matches = list(latest)
    for round_number, season in rounds:
        endpoint = f"eventsround.php?id={identifier}&r={round_number}&s={season}"
        try:
            matches.extend(sportsdb(endpoint).get("events") or [])
        except (OSError, ValueError) as error:
            print(f"{competition} round unavailable: {error}. Using the latest match feed.")
    for match in matches:
        if match["strStatus"] == "FT" and match["strLeague"] == provider_name:
            item = score(match["strHomeTeam"], match["strAwayTeam"], match["intHomeScore"],
                        match["intAwayScore"], match["dateEvent"], competition,
                        "TheSportsDB", results_url)
            if item:
                yield {**item, **match_media(match)}


def whitecaps():
    for endpoint, field in (("eventslast", "results"), ("eventsnext", "events")):
        data = sportsdb(f"{endpoint}.php?id=134147")
        for match in data.get(field) or []:
            if match["strStatus"] not in {"FT", "AET", "PEN", "Match Finished"}:
                continue
            if "Vancouver Whitecaps" not in (match["strHomeTeam"], match["strAwayTeam"]):
                continue
            timestamp = datetime.fromisoformat(match["strTimestamp"].replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=UTC)
            day = timestamp.astimezone(ZoneInfo("America/Vancouver")).date().isoformat()
            item = score(match["strHomeTeam"], match["strAwayTeam"], match["intHomeScore"],
                        match["intAwayScore"], day, match["strLeague"], "TheSportsDB",
                        "https://www.whitecapsfc.com/schedule/")
            if item:
                yield {**item, **match_media(match)}


def international(dataset, group):
    major = {"FIFA World Cup", "UEFA Euro", "Copa América", "UEFA Nations League",
             "UEFA Women's Euro", "FIFA Women's World Cup"}
    for match in csv.DictReader(io.StringIO(download(f"{DATA}{dataset}/master/results.csv"))):
        home, away = match["home_team"], match["away_team"]
        if "Canada" not in (home, away) and match["tournament"] not in major:
            continue
        yield score(home, away, match["home_score"], match["away_score"], match["date"],
                    f'{match["tournament"]} · {group}', "International Football Results",
                    f"https://github.com/martj42/{dataset}")


def entity(identifier):
    return json.loads(download(f"{WIKIDATA}{identifier}.json"))["entities"][identifier]


def is_recent(item):
    return FIRST_DAY <= item.get("date", "") <= TODAY.isoformat()


def award(identifier, name):
    winners = {}
    for claim in entity(identifier)["claims"]["P1346"]:
        winner = claim["mainsnak"].get("datavalue", {}).get("value", {}).get("id")
        if claim["rank"] == "deprecated" or not winner:
            continue
        for when in claim.get("qualifiers", {}).get("P585", []):
            value = when.get("datavalue", {}).get("value", {})
            day = value.get("time", "")[1:11]
            # Year-only and month-only entries cannot establish when news was announced.
            if value.get("precision", 0) >= 11 and is_recent({"date": day}):
                winners.setdefault(day, set()).add(winner)
    for day, identifiers in sorted(winners.items(), reverse=True)[:1]:
        if len(identifiers) != 1:
            raise ValueError(f"Conflicting award winners on {day}")
        winner = entity(next(iter(identifiers)))["labels"]["en"]["value"]
        yield dict(name=name, winner=winner, date=day, source="Wikidata", url=AWARD_ARCHIVE)


SOURCES = {
    "premier-league": ("results", lambda: sportsdb_league(
        4328, "English Premier League", "Premier League", "https://www.premierleague.com/en/results"), 10),
    "la-liga": ("results", lambda: sportsdb_league(
        4335, "Spanish La Liga", "La Liga", "https://www.laliga.com/en-GB/laliga-easports/results"), 10),
    "serie-a": ("results", lambda: sportsdb_league(
        4332, "Italian Serie A", "Serie A", "https://en.legaseriea.it/"), 10),
    "ligue-1": ("results", lambda: sportsdb_league(
        4334, "French Ligue 1", "Ligue 1", "https://ligue1.com/en/competitions/ligue1mcdonalds?tab=fixtures"), 10),
    "champions-league": ("results", lambda: european("ucl", "Champions League", "https://www.uefa.com/uefachampionsleague/fixtures-results/"), 12),
    "bundesliga": ("results", lambda: european("bl1", "Bundesliga", "https://www.bundesliga.com/en/bundesliga/matchday"), 10),
    "whitecaps": ("results", whitecaps, 3),
    "international-men": ("results", lambda: international("international_results", "Men"), 3),
    "international-women": ("results", lambda: international("womens-international-results", "Women"), 2),
    "ballon-dor-men": ("awards", lambda: award("Q166177", "Men’s Ballon d’Or"), 1),
    "ballon-dor-women": ("awards", lambda: award("Q59411480", "Women’s Ballon d’Or"), 1),
}


def sort_matches(source, matches):
    prioritize_canada = source.startswith("international-")
    return sorted(matches, key=lambda match: (
        prioritize_canada and "Canada" in (match["home"], match["away"]), match["date"]
    ), reverse=True)


def refresh(source, now):
    kind, fetch_items, limit = SOURCES[source]
    items = list(fetch_items())
    if kind == "results":
        unique = {}
        for match in items:
            if match and is_recent(match):
                unique[(match["date"], match["home"], match["away"])] = match
        items = sort_matches(source, unique.values())
    return dict(kind=kind, checkedAt=now, items=items[:limit])


def read_cache(get_text):
    try:
        content = json.loads(get_text())
        if content["version"] == 1 and isinstance(content["sources"], dict):
            return content["sources"]
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"Football news cache unavailable: {error}")
    return {}


def add_champions_league_highlights(source, previous_items=()):
    # Keep known links for unchanged scores if UEFA's catalogue is unavailable.
    manifest = Path(__file__).with_name("uefa-highlight-links.json")
    links = {match_key(row): {"url": row["highlightUrl"]}
             for row in json.loads(manifest.read_text(encoding="utf-8"))}
    for row in previous_items:
        url = row.get("highlightUrl", "")
        if isinstance(url, str) and UEFA_URL.fullmatch(url):
            thumbnail = row.get("highlightThumbnail", "")
            links[match_key(row)] = {
                "url": url,
                "thumbnail": thumbnail if isinstance(thumbnail, str) and UEFA_IMAGE.fullmatch(thumbnail) else None,
            }
    try:
        found = discover_highlights(source["items"], download)
        links.update(found)
        print(f'UEFA highlights: {len(found)} fixtures matched automatically')
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        print(f"UEFA highlights unavailable: {error}. Keeping known links.")
    for match in source["items"]:
        media = links.get(match_key(match))
        if media:
            match["highlightUrl"] = media["url"]
            if media.get("thumbnail"):
                match["highlightThumbnail"] = media["thumbnail"]
            else:
                match.pop("highlightThumbnail", None)
        else:
            match.pop("highlightUrl", None)
            match.pop("highlightThumbnail", None)


def add_espn_highlights(snapshot, previous_sources):
    fields = ("espnVideoUrl", "espnThumbnail", "espnVideoKind", "espnExpiresAt")
    for source, content in snapshot.items():
        previous = {match_key(row): row for row in previous_sources.get(source, [])
                    if "home" in row and "away" in row and "goals" in row}
        for row in content.get("items", []):
            if "home" not in row or "away" not in row or "goals" not in row:
                continue
            old = dict(previous.get(match_key(row), {}))
            for field in fields:
                row.pop(field, None)
            url = old.get("espnVideoUrl", "")
            image = old.get("espnThumbnail", "")
            expires = old.get("espnExpiresAt", "")
            try:
                available = not expires or datetime.fromisoformat(expires.replace("Z", "+00:00")) > datetime.now(UTC)
            except (ValueError, TypeError):
                available = False
            if (isinstance(url, str) and ESPN_VIDEO_URL.fullmatch(url)
                    and safe_espn_image(image) and available
                    and old.get("espnVideoKind") in {"highlights", "moment"}):
                row.update({field: old[field] for field in fields if field in old})

    def espn_download(url):
        with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=12) as response:
            content = response.read(5_000_001)
        if len(content) > 5_000_000:
            raise ValueError("ESPN response exceeded the expected size")
        return content.decode("utf-8-sig")

    try:
        found = discover_espn_highlights(snapshot, espn_download)
        for source, content in snapshot.items():
            for row in content.get("items", []):
                if "home" in row and "away" in row and "goals" in row:
                    media = found.get((source, match_key(row)))
                    if media:
                        row.update(media)
        print(f"ESPN videos: {len(found)} fixtures matched")
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        print(f"ESPN videos unavailable: {error}. Keeping known links.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("football-news.json"))
    parser.add_argument("--previous", action="store_true")
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    snapshot = read_cache(lambda: args.output.read_text(encoding="utf-8")) if args.output.exists() else {}
    if args.previous:
        live = read_cache(lambda: download("https://starsoccer.ca/football-news.json"))
        for key in SOURCES.keys() & live.keys():
            if live[key]["checkedAt"] > snapshot.get(key, {}).get("checkedAt", ""):
                snapshot[key] = live[key]
    previous_sources = {key: list(value.get("items", [])) for key, value in snapshot.items()}
    now = datetime.now(UTC).isoformat(timespec="seconds")
    failures = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending = {key: pool.submit(refresh, key, now) for key in SOURCES}
        for key, future in pending.items():
            try:
                fresh = future.result()
                if fresh["kind"] == "results":
                    matches = {
                        (row["date"], row["home"], row["away"]): row
                        for row in [*snapshot.get(key, {}).get("items", []), *fresh["items"]]
                        if is_recent(row)
                    }
                    fresh["items"] = sort_matches(key, matches.values())[:SOURCES[key][2]]
                snapshot[key] = fresh
                print(f'{key}: {len(fresh["items"])} entries verified')
            except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
                failures.append(key)
                print(f"{key}: {error}. Keeping the last successful fetch.")
    if args.strict and failures:
        raise SystemExit(f"Feed verification failed: {', '.join(failures)}")
    for source in snapshot.values():
        source["items"] = [item for item in source["items"] if is_recent(item)]
    if "champions-league" in snapshot:
        add_champions_league_highlights(snapshot["champions-league"], previous_sources.get("champions-league", []))
    add_espn_highlights(snapshot, previous_sources)
    args.output.write_text(json.dumps({"version": 1, "sources": snapshot}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
