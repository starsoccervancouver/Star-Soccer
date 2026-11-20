"""Aggregate reports for the Star Soccer winter camp landing page."""
import json
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


SITE = 'https://starsoccer.ca/'
PAGE = SITE + 'camps.html'
GA_PROPERTY = '565135484'
FORMS = ['/christmas-camp-registration.html', '/boxing-camp-registration.html']
EVENTS = ['winter_camp_signup_click', 'winter_camp_form_start', 'registration_submission_accepted']


def google_reader(scope):
    metadata = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes='
    with urlopen(Request(metadata + quote('https://www.googleapis.com/auth/' + scope, safe=''),
                         headers={'Metadata-Flavor': 'Google'}), timeout=4) as response:
        token = json.load(response)['access_token']

    def read(endpoint, body):
        headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
        with urlopen(Request(endpoint, data=json.dumps(body).encode(), headers=headers), timeout=8) as response:
            return json.load(response)
    return read


def search_report(start, end):
    read = google_reader('webmasters.readonly')
    endpoint = 'https://www.googleapis.com/webmasters/v3/sites/' + quote(SITE, safe='') + '/searchAnalytics/query'
    filters = [{'filters': [{'dimension': 'page', 'operator': 'equals', 'expression': PAGE}]}]
    def rows(dimension, limit):
        data = read(endpoint, dict(startDate=start, endDate=end, type='web', dataState='final',
                                   aggregationType='byPage', dimensionFilterGroups=filters,
                                   dimensions=[dimension], rowLimit=limit))
        return [{dimension: row['keys'][0], 'clicks': int(row['clicks']),
                 'impressions': int(row['impressions'])} for row in data.get('rows', [])]
    return {'days': rows('date', 93), 'queries': rows('query', 10)}


def exact(field, value):
    return {'filter': {'fieldName': field, 'stringFilter': {'value': value, 'matchType': 'EXACT'}}}


def analytics_report(start, end):
    read = google_reader('analytics.readonly')
    endpoint = 'https://analyticsdata.googleapis.com/v1beta/properties/' + GA_PROPERTY + ':batchRunReports'
    cohort = [exact('sessionSource', 'google'), exact('sessionMedium', 'organic'),
              exact('landingPage', '/camps.html'), exact('hostName', 'starsoccer.ca')]
    def report(dims, metric, filters):
        return {'dateRanges': [{'startDate': start, 'endDate': end}],
                'dimensions': [{'name': dim} for dim in dims], 'metrics': [{'name': metric}],
                'dimensionFilter': {'andGroup': {'expressions': filters}}}
    requests = [report(['date'], 'sessions', cohort)]
    for event in EVENTS:
        paths = ['/camps.html'] if event == EVENTS[0] else FORMS
        path_filter = {'filter': {'fieldName': 'pagePath', 'inListFilter': {'values': paths}}}
        requests.append(report(['eventName'], 'eventCount', cohort + [exact('eventName', event), path_filter]))
    reports = read(endpoint, {'requests': requests})['reports']
    if len(reports) != 4:
        raise ValueError('Incomplete Analytics response')
    visits = [{'date': r['dimensionValues'][0]['value'], 'sessions': int(r['metricValues'][0]['value'])}
              for r in reports[0].get('rows', [])]
    counts = {}
    for name, result in zip(EVENTS, reports[1:]):
        rows = result.get('rows', [])
        counts[name] = int(rows[0]['metricValues'][0]['value']) if rows else None
    return {'days': visits, 'events': counts,
            'thresholded': any(r.get('metadata', {}).get('subjectToThresholding') for r in reports)}


def source_result(reader, start, end):
    try:
        return {'status': 'ok', **reader(start, end)}
    except HTTPError as exc:
        return {'status': 'unavailable', 'reason': 'Google returned HTTP ' + str(exc.code)}
    except (URLError, TimeoutError, KeyError, TypeError, ValueError):
        return {'status': 'unavailable', 'reason': 'Google returned an incomplete response or timed out'}


def winter_report(start, end):
    with ThreadPoolExecutor(max_workers=2) as pool:
        search = pool.submit(source_result, search_report, start, end)
        analytics = pool.submit(source_result, analytics_report, start, end)
        return {'page': PAGE, 'startDate': start, 'endDate': end,
                'search': search.result(), 'analytics': analytics.result()}
