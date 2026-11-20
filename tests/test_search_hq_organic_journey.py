import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services' / 'search-hq'))
from organic_journey import FORMS, journey_queries, organic_journey, organic_journey_response


def report(dim, metric, rows, **metadata):
    return {'metadata': {'timeZone': 'America/Vancouver', **metadata},
            'dimensionHeaders': [{'name': dim}] if dim else [],
            'metricHeaders': [{'name': metric}], 'rowCount': len(rows),
            'rows': [{'dimensionValues': [{'value': label}] if dim else [],
                      'metricValues': [{'value': str(count)}]} for label, count in rows]}


class JourneyTest(unittest.TestCase):
    start, end = date(2026, 11, 20), date(2026, 11, 21)
    now = datetime(2026, 11, 26, tzinfo=timezone.utc)

    def setUp(self):
        self.reports = [
            report('date', 'eventCount', [('20261120', 80), ('20261121', 40)]),
            report(None, 'sessions', [('', 20)]), report(None, 'sessions', [('', 3)]),
            report('pagePath', 'sessions', [(FORMS[0], 6), (FORMS[1], 2)])]

    def run_report(self):
        return organic_journey(self.start, self.end, self.now, lambda body: self.reports)

    def test_week_and_scope(self):
        data = self.run_report()
        self.assertEqual((data['sessions'], data['convertedSessions']), (20, 3))
        self.assertEqual([row['sessions'] for row in data['formViews']], [6, 2, 0, 0])
        queries = journey_queries(self.start, self.end)['requests']
        for query in queries[1:]:
            self.assertEqual(query['metrics'], [{'name': 'sessions'}])
            filters = str(query['dimensionFilter'])
            for value in ['starsoccer.ca', 'search_hq_test']:
                self.assertIn(value, filters)
            self.assertNotIn('landingPage', filters)
        self.assertIn('registration_submission_accepted', str(queries[2]))
        self.assertIn('page_view', str(queries[3]))
        self.assertTrue(all('sessionMedium' in str(query) for query in queries[1:3]))
        self.assertNotIn('sessionMedium', str(queries[3]))
        self.reports[3] = report('pagePath', 'sessions', [(FORMS[0], 35)])
        self.assertEqual(self.run_report()['formViews'][0]['sessions'], 35)

    def test_history_or_freshness_is_not_zero(self):
        def never(_):
            self.fail('Should not request GA4 data')
        for start, end, now in [(date(2026, 11, 9), date(2026, 11, 15), self.now),
                                (self.start, self.end, datetime(2026, 11, 23, tzinfo=timezone.utc))]:
            data = organic_journey(start, end, now, never)
            self.assertIsNone(data['sessions'])
            self.assertIsNone(data['convertedSessions'])

    def test_pre_event_instrumentation_keeps_traffic_and_forms(self):
        day = date(2026, 11, 19)
        self.reports[0] = report('date', 'eventCount', [('20261119', 5)])
        data = organic_journey(day, day, self.now, lambda _: self.reports)
        self.assertEqual(data['sessions'], 20)
        self.assertIsNone(data['convertedSessions'])
        self.assertIsNotNone(data['formViews'])

    def test_flags_and_missing_rows(self):
        self.reports[2]['metadata']['subjectToThresholding'] = True
        self.assertIsNone(self.run_report()['convertedSessions'])
        self.assertEqual(self.run_report()['sessions'], 20)
        self.reports[2] = report(None, 'sessions', [])
        self.assertEqual(self.run_report()['convertedSessions'], 0)
        self.reports[0]['rowCount'] = 4
        self.assertIsNone(self.run_report()['sessions'])

    def test_missing_day_or_mismatched_time_zone(self):
        for replacement in [report('date', 'eventCount', [('20261120', 80)]),
                            report('date', 'eventCount', [('20261120', 8), ('20261121', 4)], timeZone='UTC')]:
            self.reports[0] = replacement
            self.assertIsNone(self.run_report()['sessions'])

    def test_conflicting_ga_counts_fail_independently(self):
        self.reports[2] = report(None, 'sessions', [('', 21)])
        self.reports[3] = report('pagePath', 'sessions', [('/unrelated', 1)])
        result = self.run_report()
        self.assertEqual(result['sessions'], 20)
        self.assertIsNone(result['formViews'])
        self.assertIsNone(result['convertedSessions'])

    def test_unknown_reports_and_invalid_dates(self):
        self.assertIsNone(organic_journey_response({'report': 'winterCamp'}))
        self.assertEqual(organic_journey_response({'report': 'organicJourney', 'startDate': '20261102',
                                                  'endDate': '2026-11-09'})[1], 400)


if __name__ == '__main__':
    unittest.main()
