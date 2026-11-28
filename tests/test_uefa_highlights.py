"""Regression checks for matching UEFA highlights to public score-feed fixtures."""
import importlib.util
import json
import sys
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import uefa_highlights as uefa

spec = importlib.util.spec_from_file_location("football_refresh", ROOT / "scripts" / "refresh-football-news.py")
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)

VIDEO_ID = "02ab-222871ca3407-ab3f8f54d19d-1000"
VIDEO_URL = "https://www.uefa.com/uefachampionsleague/video/" + VIDEO_ID + "/"
OLD_URL = "https://www.uefa.com/news-media/video/02ab-222871ca3407-ab3f8f54d19d-1000--old/"
NOW = datetime(2027, 2, 25, 12, tzinfo=UTC)


def feed_match(**changes):
    return {"date": "2027-02-24", "home": "FC Arsenal", "away": "Borussia Dortmund",
            "goals": [1, 1], **changes}


def editorial_node(**changes):
    node = {
        "id": VIDEO_ID,
        "title": "Champions League highlights: Arsenal 1-1 B. Dortmund",
        "pubInfo": {"status": "LIVE", "visible": True},
        "attributes": {
            "language": "en",
            "firstPublicationDate": "2027-02-24T23:30:00Z",
            "main": {"competition": "1", "kind": "Medium Highlights"},
            "webReference": "/uefachampionsleague/video/" + VIDEO_ID + "--arsenal-highlights",
            "footballEntities": [{"match": {
                "matchId": "12345", "homeTeamId": "1", "awayTeamId": "2",
                "kickoffTime": "2027-02-24T20:00:00Z",
            }}],
        },
    }
    node.update(changes)
    return node


def official_match(**changes):
    return {
        "id": "12345", "status": "FINISHED", "competition": {"id": "1"},
        "homeTeam": {"id": "1", "internationalName": "Arsenal"},
        "awayTeam": {"id": "2", "internationalName": "B. Dortmund",
                     "translations": {"displayOfficialName": {"EN": "Borussia Dortmund"}}},
        "kickOffTime": {"date": "2027-02-24"},
        "score": {"total": {"home": 1, "away": 1}},
        **changes,
    }


def lookup(items, nodes=None, matches=None):
    nodes = [editorial_node()] if nodes is None else nodes
    matches = [official_match()] if matches is None else matches
    requests = []

    def download(url):
        requests.append(url)
        if url.startswith(uefa.EDITORIAL):
            return json.dumps({"result": [{"nodeData": node} for node in nodes]})
        if url.startswith(uefa.MATCHES):
            return json.dumps(matches)
        raise AssertionError(url)

    return uefa.discover_highlights(items, download, now=NOW), requests


class AutomaticHighlights(unittest.TestCase):
    def test_future_match_is_discovered_with_official_team_names(self):
        match = feed_match()
        links, requests = lookup([match])
        self.assertEqual(links, {uefa.match_key(match): VIDEO_URL})
        self.assertEqual(len(requests), 2)

    def test_changed_score_date_team_or_identity_never_matches(self):
        for change in ({"goals": [2, 1]}, {"date": "2027-02-23"},
                       {"home": "Chelsea"}, {"away": "Borussia Mönchengladbach"}):
            with self.subTest(change=change):
                links, _ = lookup([feed_match(**change)])
                self.assertEqual(links, {})
        wrong_identity = official_match(awayTeam={"id": "99", "internationalName": "Borussia Dortmund"})
        self.assertEqual(lookup([feed_match()], matches=[wrong_identity])[0], {})

    def test_unreleased_or_invalid_video_is_not_published(self):
        unpublished = editorial_node()
        unpublished["pubInfo"]["startVisible"] = "2027-02-26T00:00:00Z"
        invalid = editorial_node()
        invalid["attributes"]["webReference"] = "https://example.com/video"
        for node in (unpublished, invalid):
            with self.subTest(node=node):
                links, requests = lookup([feed_match()], nodes=[node])
                self.assertEqual(links, {})
                self.assertEqual(len(requests), 1)

    def test_an_incorrect_video_does_not_hide_a_correct_one(self):
        wrong_score = editorial_node(title="Champions League highlights: Arsenal 2-1 B. Dortmund")
        links, _ = lookup([feed_match()], nodes=[wrong_score, editorial_node()])
        self.assertEqual(links, {uefa.match_key(feed_match()): VIDEO_URL})

    def test_catalogue_pagination_finds_an_older_fixture(self):
        older = editorial_node()
        earlier = editorial_node()
        earlier["attributes"]["footballEntities"][0]["match"]["kickoffTime"] = "2027-02-22T20:00:00Z"
        urls = []

        def download(url):
            urls.append(url)
            if url.startswith(uefa.MATCHES):
                return json.dumps([official_match()])
            nodes = [earlier] * 100 if "offset=0" in url else [older]
            return json.dumps({"result": [{"nodeData": node} for node in nodes]})

        links = uefa.discover_highlights([feed_match()], download, now=NOW)
        self.assertEqual(links, {uefa.match_key(feed_match()): VIDEO_URL})
        self.assertEqual(len(urls), 3)

    def test_ambiguous_feed_fixtures_do_not_receive_a_link(self):
        matches = [feed_match(), feed_match(home="Arsenal FC")]
        self.assertEqual(lookup(matches)[0], {})

    def test_previous_link_survives_outage_only_for_the_same_score(self):
        old = feed_match(highlightUrl=OLD_URL)
        same = feed_match()
        changed = feed_match(goals=[2, 1], highlightUrl=OLD_URL)
        source = {"items": [same, changed]}
        with patch.object(refresh, "discover_highlights", side_effect=OSError("offline")):
            refresh.add_champions_league_highlights(source, [old])
        self.assertEqual(same["highlightUrl"], OLD_URL)
        self.assertNotIn("highlightUrl", changed)

    def test_new_automatic_link_replaces_old_link(self):
        old = feed_match(highlightUrl=OLD_URL)
        match = feed_match()
        source = {"items": [match]}
        with patch.object(refresh, "discover_highlights", return_value={uefa.match_key(match): VIDEO_URL}):
            refresh.add_champions_league_highlights(source, [old])
        self.assertEqual(match["highlightUrl"], VIDEO_URL)


if __name__ == "__main__":
    unittest.main()
