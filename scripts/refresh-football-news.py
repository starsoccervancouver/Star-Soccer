"""Generate the homepage football feed using public scores and award records."""
import argparse
import csv
import io
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

TODAY = datetime.now(ZoneInfo("America/Vancouver")).date()
FIRST_DAY = (TODAY - timedelta(days=6)).isoformat()
AGENT = "StarSoccer.ca football news (https://starsoccer.ca/contact.html)"
DATA = "https://raw.githubusercontent.com/martj42/"
SPORTSDB = "https://www.thesportsdb.com/api/v1/json/123/"
WIKIDATA = "https://www.wikidata.org/wiki/Special:EntityData/"
AWARD_ARCHIVE = "https://www.uefa.com/ballondor/"


def download(url):
    with urlopen(Request(url, headers={"User-Agent": AGENT}), timeout=12) as response:
        data = response.read(5_000_001)
    if len(data) > 5_000_000:
        raise ValueError("Feed exceeded the expected size")
    return data.decode("utf-8-sig")


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


def premier_league():
    data = json.loads(download(f"{SPORTSDB}eventspastleague.php?id=4328"))
    for match in data.get("events") or []:
        if match["strStatus"] == "FT" and match["strLeague"] == "English Premier League":
            yield score(match["strHomeTeam"], match["strAwayTeam"], match["intHomeScore"],
                        match["intAwayScore"], match["dateEvent"], "Premier League",
                        "TheSportsDB", "https://www.premierleague.com/en/results")


def whitecaps():
    for endpoint, field in (("eventslast", "results"), ("eventsnext", "events")):
        data = json.loads(download(f"{SPORTSDB}{endpoint}.php?id=134147"))
        for match in data.get(field) or []:
            if match["strStatus"] not in {"FT", "AET", "PEN", "Match Finished"}:
                continue
            if "Vancouver Whitecaps" not in (match["strHomeTeam"], match["strAwayTeam"]):
                continue
            timestamp = datetime.fromisoformat(match["strTimestamp"].replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=UTC)
            day = timestamp.astimezone(ZoneInfo("America/Vancouver")).date().isoformat()
            yield score(match["strHomeTeam"], match["strAwayTeam"], match["intHomeScore"],
                        match["intAwayScore"], day, match["strLeague"], "TheSportsDB",
                        "https://www.whitecapsfc.com/schedule/")


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
    "premier-league": ("results", premier_league, 2),
    "champions-league": ("results", lambda: european("ucl", "Champions League", "https://www.uefa.com/uefachampionsleague/fixtures-results/"), 2),
    "bundesliga": ("results", lambda: european("bl1", "Bundesliga", "https://www.bundesliga.com/en/bundesliga/matchday"), 2),
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
    args.output.write_text(json.dumps({"version": 1, "sources": snapshot}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
