"""Find UEFA's published highlights for the exact Champions League fixtures in the feed."""
import json
import re
import unicodedata
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from urllib.parse import urlencode

EDITORIAL = "https://editorial.uefa.com/api/cachedsearch/build?"
MATCHES = "https://match.uefa.com/v5/matches?"
VIDEO_ID = re.compile(r"[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{12}-[0-9]{4}")
UEFA_URL = re.compile(
    r"https://www\.uefa\.com/(?:news-media/video|uefachampionsleague/video(?:/highlights)?)/[a-z0-9-]+/"
)
UEFA_IMAGE = re.compile(
    r"https://editorial\.uefa\.com/resources/[0-9a-f-]+/format/wide1/[A-Za-z0-9_.-]+"
)
SCORE = re.compile(r"\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b")
CLUB_WORDS = {"fc", "cf", "afc", "ac", "as", "sc", "sk", "fk", "vfb", "ssc", "osc", "kv", "club", "de", "sv"}
TEAM_ALIASES = {
    "inter mailand": "inter",
    "galatasaray istanbul": "galatasaray",
    "feyenoord rotterdam": "feyenoord",
    "slavia prag": "slavia praha",
    "rom": "roma",
    "aek athen": "aek athens",
    "bayern munich": "bayern munchen",
    "internazionale": "inter",
    "slavia prague": "slavia praha",
    "hamburger": "hamburg",
    "1 fsv mainz 05": "mainz",
}
VIDEO_PRIORITY = {"Medium Highlights": 0, "Highlights": 1, "Long Highlights": 2}


def normalized_team(name):
    text = name.casefold().translate(str.maketrans({"ø": "o", "ł": "l", "æ": "ae", "ß": "ss"}))
    text = "".join(char for char in unicodedata.normalize("NFKD", text)
                   if not unicodedata.combining(char))
    words = re.findall(r"[a-z0-9]+", text)
    normalized = " ".join("saint" if word == "st" else word
                          for word in words if word not in CLUB_WORDS)
    return TEAM_ALIASES.get(normalized, normalized)


def official_team_names(team):
    translations = team.get("translations", {})
    names = [team.get("internationalName", "")]
    for field in ("displayName", "displayOfficialName", "shortName"):
        names.extend(translations.get(field, {}).get(language, "") for language in ("EN", "DE"))
    return {normalized_team(name) for name in names if name}


def video_thumbnail(node):
    picture = node.get("picture", "")
    if not isinstance(picture, str) or not VIDEO_ID.fullmatch(picture):
        return None
    document = node.get("files", {}).get("content.json", {}).get("data", {}).get("document", {})
    for group in document.get("mediagroup", []):
        for figure in group.get("figure", []):
            for image in figure.get("img", []):
                prefix = "/resources/" + picture + "/"
                source = image.get("src", "")
                if (image.get("emk-softCrop") == "Wide" and image.get("data-id") == picture
                        and isinstance(source, str) and source.startswith(prefix)):
                    filename = source[len(prefix):]
                    url = "https://editorial.uefa.com" + prefix + "format/wide1/" + filename
                    if UEFA_IMAGE.fullmatch(url):
                        return url
    return None


def valid_video(node, now):
    attributes = node.get("attributes", {})
    main = attributes.get("main", {})
    publication = node.get("pubInfo", {})
    kind = main.get("kind")
    reference = attributes.get("webReference", "")
    video_id = node.get("id", "")
    if (main.get("competition") != "1" or kind not in VIDEO_PRIORITY
            or attributes.get("language") != "en" or attributes.get("hideFromWeb") is True
            or publication.get("status") != "LIVE" or publication.get("visible") is not True
            or not isinstance(reference, str) or not VIDEO_ID.fullmatch(video_id)
            or not reference.startswith(("/uefachampionsleague/video/" + video_id,
                                         "/uefachampionsleague/video/highlights/" + video_id))):
        return None

    visible_at = publication.get("startVisible") or attributes.get("firstPublicationDate")
    if not visible_at or datetime.fromisoformat(visible_at.replace("Z", "+00:00")) > now:
        return None
    entities = [entry["match"] for entry in attributes.get("footballEntities", [])
                if isinstance(entry, dict) and "match" in entry]
    if len(entities) != 1:
        return None
    match = entities[0]
    match_id = str(match.get("matchId", ""))
    if not match_id.isdecimal() or not match.get("homeTeamId") or not match.get("awayTeamId"):
        return None
    kickoff = datetime.fromisoformat(match["kickoffTime"].replace("Z", "+00:00")).date()
    score = SCORE.search(node.get("title", ""))
    if not score:
        return None
    return {
        "match_id": match_id,
        "home_id": str(match["homeTeamId"]),
        "away_id": str(match["awayTeamId"]),
        "kickoff": kickoff,
        "goals": (int(score.group(1)), int(score.group(2))),
        "url": "https://www.uefa.com/uefachampionsleague/video/" + video_id + "/",
        "thumbnail": video_thumbnail(node),
        "priority": VIDEO_PRIORITY[kind],
    }


def discover_highlights(items, download, now=None):
    """Return exact feed keys and video URLs discovered in UEFA's public catalogue."""
    if not items:
        return {}
    now = now or datetime.now(UTC)
    dates = {date.fromisoformat(item["date"]) for item in items}
    parameters = {
        "aggregator": "lightnodejson",
        "limit": 100,
        "offset": 0,
        "param.attributes.language": "en",
        "param.attributes.main.competition": "1",
        "param.attributes.main.kind": "Medium Highlights,Highlights,Long Highlights",
        "sorting": "-attributes.firstPublicationDate",
        "type": "videostory",
    }
    videos = {}
    # Publication dates are sorted newest first. Stop after passing the earliest
    # fixture date, while allowing for differences between UTC and local dates.
    cutoff = min(dates) - timedelta(days=1)
    for offset in range(0, 400, 100):
        parameters["offset"] = offset
        catalogue = json.loads(download(EDITORIAL + urlencode(parameters)))
        results = catalogue["result"]
        for result in results:
            try:
                video = valid_video(result["nodeData"], now)
            except (KeyError, TypeError, ValueError):
                continue
            if not video or not any(abs((video["kickoff"] - day).days) <= 1 for day in dates):
                continue
            videos.setdefault(video["match_id"], []).append(video)
        if len(results) < parameters["limit"]:
            break
        last_date = results[-1]["nodeData"].get("attributes", {}).get("firstPublicationDate", "")
        if last_date and date.fromisoformat(last_date[:10]) < cutoff:
            break
    if not videos:
        return {}

    match_url = MATCHES + urlencode({"matchId": ",".join(sorted(videos))})
    official_matches = json.loads(download(match_url))
    candidates = []
    for official in official_matches:
        match_id = str(official.get("id", ""))
        if official.get("status") != "FINISHED" or str(official.get("competition", {}).get("id")) != "1":
            continue
        home = official.get("homeTeam", {})
        away = official.get("awayTeam", {})
        total = official.get("score", {}).get("total", {})
        goals = (total.get("home"), total.get("away"))
        matching_videos = [
            video for video in videos.get(match_id, [])
            if str(home.get("id")) == video["home_id"]
            and str(away.get("id")) == video["away_id"]
            and goals == video["goals"]
        ]
        if not matching_videos:
            continue
        video = min(matching_videos, key=lambda item: item["priority"])
        candidates.append({
            "id": video["match_id"],
            "date": official.get("kickOffTime", {}).get("date"),
            "home": official_team_names(home),
            "away": official_team_names(away),
            "goals": goals,
            "url": video["url"],
            "thumbnail": video["thumbnail"],
        })

    matched = []
    for item in items:
        home_name = normalized_team(item["home"])
        away_name = normalized_team(item["away"])
        if not home_name or not away_name:
            continue
        possible = [candidate for candidate in candidates
                    if candidate["date"] == item["date"]
                    and candidate["goals"] == tuple(item["goals"])
                    and home_name in candidate["home"]
                    and away_name in candidate["away"]]
        if len(possible) == 1:
            matched.append((match_key(item), possible[0]))
    occurrences = Counter(candidate["id"] for _, candidate in matched)
    return {key: {"url": candidate["url"], "thumbnail": candidate["thumbnail"]}
            for key, candidate in matched if occurrences[candidate["id"]] == 1}


def match_key(match):
    return (match["date"], match["home"].strip(), match["away"].strip(), tuple(match["goals"]))
