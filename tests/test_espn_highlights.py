"""Regression checks for exact-match ESPN video and thumbnail selection."""
import importlib.util
import json
import sys
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import espn_highlights as espn
from uefa_highlights import match_key

spec = importlib.util.spec_from_file_location(
    "football_refresh", Path(__file__).resolve().parents[1] / "scripts" / "refresh-football-news.py"
)
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)

NOW = datetime(2027, 2, 25, 12, tzinfo=UTC)
VIDEO = "https://www.espn.com/video/clip/_/id/123456/future-match-highlights"
IMAGE = "https://espnmedia-cdn.akamaized.net/espn/media/common/future-match.jpg"


def source_match(**changes):
    return {"date": "2027-02-24", "home": "FC Arsenal", "away": "Manchester United FC",
            "goals": [2, 1], **changes}


def event(**changes):
    return {"id": "123", "date": "2027-02-24T20:00Z",
            "status": {"type": {"completed": True}},
            "competitions": [{"competitors": [
                {"homeAway": "home", "score": "2", "team": {"displayName": "Arsenal"}},
                {"homeAway": "away", "score": "1", "team": {"displayName": "Manchester United"}},
            ]}], **changes}


def clip(**changes):
    return {"headline": "Arsenal vs. Manchester United - Match Highlights", "thumbnail": IMAGE,
            "links": {"web": {"href": VIDEO}}, "timeRestrictions": {
                "embargoDate": "2027-02-24T22:00:00Z",
                "expirationDate": "2027-03-25T00:00:00Z",
            }, **changes}


def run_lookup(match=None, events=None, videos=None):
    match = source_match() if match is None else match
    events = [event()] if events is None else events
    videos = [clip()] if videos is None else videos
    calls = []

    def download(url):
        calls.append(url)
        if "/scoreboard?" in url:
            return json.dumps({"events": events})
        if "/summary?" in url:
            return json.dumps({"header": {"id": "123"}, "videos": videos})
        raise AssertionError(url)

    result = espn.discover_highlights(
        {"premier-league": {"items": [match]}}, download, now=NOW
    )
    return result, calls


class ESPNMatching(unittest.TestCase):
    def test_matches_future_result_with_its_own_video_thumbnail(self):
        match = source_match()
        result, calls = run_lookup(match)
        media = result[("premier-league", match_key(match))]
        self.assertEqual(media["espnVideoUrl"], VIDEO)
        self.assertEqual(media["espnThumbnail"], IMAGE)
        self.assertEqual(media["espnVideoKind"], "highlights")
        self.assertEqual(len(calls), 2)

    def test_other_teams_score_or_date_cannot_match(self):
        for changes in ({"home": "Chelsea"}, {"away": "Manchester City"}, {"goals": [2, 0]},
                        {"date": "2027-02-23"}):
            with self.subTest(changes=changes):
                result, calls = run_lookup(source_match(**changes))
                self.assertEqual(result, {})
                self.assertEqual(len(calls), 1)

    def test_prefer_full_highlights_and_respect_canadian_access(self):
        uk_only = clip(geoRestrictions={"type": "whitelist", "countries": ["GB", "IE"]})
        moment = clip(headline="Arsenal scores late winner", description="Arsenal vs Man Utd")
        sides = ({"arsenal"}, {"manchester united"})
        media = espn.clip_media({"header": {"id": "123"}, "videos": [uk_only, moment]}, "123", NOW, *sides)
        self.assertEqual(media["espnVideoKind"], "moment")
        full = clip(geoRestrictions={"type": "whitelist", "countries": ["CA"]})
        media = espn.clip_media({"header": {"id": "123"}, "videos": [moment, full]}, "123", NOW, *sides)
        self.assertEqual(media["espnVideoKind"], "highlights")

    def test_expired_unreleased_wrong_id_or_untrusted_media_are_rejected(self):
        expired = clip(timeRestrictions={"expirationDate": "2027-02-24T23:00:00Z"})
        embargo = clip(timeRestrictions={"embargoDate": "2027-02-26T00:00:00Z"})
        untrusted = clip(thumbnail="https://example.com/photo.jpg")
        sides = ({"arsenal"}, {"manchester united"})
        for video in (expired, embargo, untrusted):
            with self.subTest(video=video):
                self.assertIsNone(espn.clip_media({"header": {"id": "123"}, "videos": [video]}, "123", NOW, *sides))
        self.assertIsNone(espn.clip_media({"header": {"id": "999"}, "videos": [clip()]}, "123", NOW, *sides))

    def test_related_videos_cannot_supply_the_match_image(self):
        unrelated = clip(headline="Arsenal vs. Chelsea - Match Highlights")
        incomplete = clip(headline="Arsenal scores late winner")
        result, _ = run_lookup(videos=[unrelated, incomplete])
        self.assertEqual(result, {})

    def test_clip_can_use_recognizable_team_abbreviations(self):
        sides = ({"barcelona"}, {"villarreal"})
        moment = clip(headline="Buchanan's strike gives Villarreal the lead at Barca")
        media = espn.clip_media({"header": {"id": "123"}, "videos": [moment]}, "123", NOW, *sides)
        self.assertEqual(media["espnVideoKind"], "moment")

    def test_cached_video_survives_an_outage_for_the_same_result_only(self):
        old = source_match(espnVideoUrl=VIDEO, espnThumbnail=IMAGE,
                           espnVideoKind="highlights", espnExpiresAt="2029-01-01T00:00:00Z")
        same = source_match()
        changed = source_match(goals=[3, 1], espnVideoUrl=VIDEO, espnThumbnail=IMAGE,
                               espnVideoKind="highlights", espnExpiresAt="2020-01-01T00:00:00Z")
        snapshot = {"premier-league": {"items": [same, changed]}}
        with patch.object(refresh, "discover_espn_highlights", side_effect=OSError("offline")):
            refresh.add_espn_highlights(snapshot, {"premier-league": [old]})
        self.assertEqual(same["espnThumbnail"], IMAGE)
        self.assertNotIn("espnVideoUrl", changed)

    def test_expired_cached_video_does_not_block_a_new_lookup(self):
        expired = source_match(espnVideoUrl=VIDEO, espnThumbnail=IMAGE,
                               espnVideoKind="highlights", espnExpiresAt="2020-01-01T00:00:00Z")
        snapshot = {"premier-league": {"items": [expired]}}
        with patch.object(refresh, "discover_espn_highlights", return_value={}) as discover:
            refresh.add_espn_highlights(snapshot, {"premier-league": [expired]})
        self.assertNotIn("espnVideoUrl", expired)
        self.assertNotIn("espnVideoKind", discover.call_args.args[0]["premier-league"]["items"][0])

    def test_ambiguous_events_do_not_get_a_video(self):
        result, _ = run_lookup(events=[event(), event(id="456")])
        self.assertEqual(result, {})


if __name__ == "__main__":
    unittest.main()
