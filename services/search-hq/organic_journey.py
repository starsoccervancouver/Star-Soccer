"""Aggregate Google's organic sessions for Search HQ without returning visitor data."""
import json
from datetime import date, datetime, time, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


PROPERTY = 'https://starsoccer.ca/'
GA_PROPERTY = '565135484'
VANCOUVER = ZoneInfo('America/Vancouver')
# Tracking first appeared on Nov 18. Nov 19 was the first full site traffic day.
TRAFFIC_FROM = date(2026, 11, 19)
# The accepted-event deployment was verified on Nov 19.
ACCEPTED_FROM = date(2026, 11, 20)
FORMS = ('/registration.html', '/christmas-camp-registration.html',
         '/boxing-camp-registration.html', '/pro-d-camp-registration.html')


def exact(field, value):
    return {'filter': {'fieldName': field, 'stringFilter': {'value': value, 'matchType': 'EXACT'}}}


def journey_queries(start, end):
    host = exact('hostName', 'starsoccer.ca')
    site = [host, {'notExpression': exact('sessionCampaignName', 'search_hq_test')}]
    cohort = site + [exact('sessionSource', 'google'), exact('sessionMedium', 'organic')]
    forms = {'filter': {'fieldName': 'pagePath', 'inListFilter': {'values': list(FORMS)}}}

    def query(metric, filters, dimensions=()):
        return {'dateRanges': [{'startDate': start.isoformat(), 'endDate': end.isoformat()}],
                'metrics': [{'name': metric}], 'dimensions': [{'name': dim} for dim in dimensions],
                'dimensionFilter': {'andGroup': {'expressions': filters}}}

    return {'requests': [
        query('eventCount', [host, exact('eventName', 'page_view')], ['date']),
        query('sessions', cohort),
        query('sessions', cohort + [exact('eventName', 'registration_submission_accepted'), forms]),
        query('sessions', site + [exact('eventName', 'page_view'), forms], ['pagePath'])
    ]}


def read_google(body):
    token_url = ('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/'
                 'token?scopes=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fanalytics.readonly')
    with urlopen(Request(token_url, headers={'Metadata-Flavor': 'Google'}), timeout=4) as response:
        token = json.load(response)['access_token']
    endpoint = 'https://analyticsdata.googleapis.com/v1beta/properties/' + GA_PROPERTY + ':batchRunReports'
    request = Request(endpoint, data=json.dumps(body).encode(),
                      headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urlopen(request, timeout=12) as response:
        return json.load(response)['reports']


def counts(report, dimensions, metric, dates):
    metadata = report['metadata']
    if any(metadata.get(flag) for flag in ('subjectToThresholding', 'dataLossFromOtherRow', 'samplingMetadatas',
                                           'schemaRestrictionResponse', 'emptyReason')):
        raise ValueError('Incomplete GA4 data')
    zone = ZoneInfo(metadata['timeZone'])
    if any(datetime.combine(day, time.min, zone).utcoffset() !=
           datetime.combine(day, time.min, VANCOUVER).utcoffset() for day in dates):
        raise ValueError('Different reporting day boundaries')
    if [h['name'] for h in report['metricHeaders']] != [metric] or [
            h['name'] for h in report.get('dimensionHeaders', [])] != dimensions:
        raise ValueError('Unexpected GA4 headers')
    rows = report.get('rows', [])
    if report.get('rowCount', 0) != len(rows):
        raise ValueError('Incomplete GA4 rows')
    result = {}
    for row in rows:
        dims = tuple(item['value'] for item in row.get('dimensionValues', []))
        values = row['metricValues']
        if len(dims) != len(dimensions) or dims in result or len(values) != 1:
            raise ValueError('Unexpected GA4 row')
        value = values[0]['value']
        if not isinstance(value, str) or not value.isascii() or not value.isdecimal():
            raise ValueError('Invalid count')
        result[dims] = int(value)
    return result


def organic_journey(start, end, now, read):
    result = {'report': 'organicJourney', 'property': PROPERTY, 'startDate': start.isoformat(),
              'endDate': end.isoformat(), 'sessions': None, 'convertedSessions': None, 'formViews': None}
    if start < TRAFFIC_FROM:
        return {**result, 'reason': 'Sitewide GA4 tracking did not cover this whole period.'}
    boundary = datetime.combine(end + timedelta(days=1), time.min, VANCOUVER)
    if now.astimezone(timezone.utc) - boundary.astimezone(timezone.utc) < timedelta(hours=48):
        return {**result, 'reason': 'GA4 can take 48 hours after the last day to process this period.'}
    # Include midnight following the last day to compare the entire reporting interval.
    dates = [start + timedelta(days=n) for n in range((end - start).days + 2)]
    try:
        coverage, sessions, accepted, forms = read(journey_queries(start, end))
        activity = counts(coverage, ['date'], 'eventCount', dates)
        if not all(activity.get((day.strftime('%Y%m%d'),), 0) > 0 for day in dates[:-1]):
            return {**result, 'reason': 'GA4 site activity could not be verified for every day.'}
    except HTTPError as exc:
        return {**result, 'reason': f'Google Analytics returned HTTP {exc.code}.'}
    except (URLError, TimeoutError, KeyError, TypeError, ValueError):
        return {**result, 'reason': 'GA4 returned incomplete data or different reporting-day boundaries.'}

    reasons = []
    def checked(report, dimensions):
        try:
            return counts(report, dimensions, 'sessions', dates)
        except (ValueError, KeyError, TypeError, ZoneInfoNotFoundError):
            return None

    overall = checked(sessions, [])
    if overall is not None:
        result['sessions'] = overall.get((), 0)
    else:
        reasons.append('The Google organic visit total is unavailable.')
    converted = checked(accepted, [])
    if start < ACCEPTED_FROM:
        reasons.append('Registration tracking did not cover this whole period.')
    elif converted is None or overall is None or converted.get((), 0) > result['sessions']:
        reasons.append('The number of visits with an accepted registration could not be verified.')
    else:
        result['convertedSessions'] = converted.get((), 0)
    page_counts = checked(forms, ['pagePath'])
    if page_counts is None or any(path not in FORMS for path, in page_counts):
        reasons.append('Registration page visits could not be verified.')
    else:
        result['formViews'] = [{'path': path, 'sessions': page_counts.get((path,), 0)} for path in FORMS]
    if reasons:
        result['reason'] = ' '.join(reasons)
    return result


def organic_journey_response(data):
    if not isinstance(data, dict) or data.get('report') != 'organicJourney':
        return None
    try:
        if set(data) != {'report', 'startDate', 'endDate'}:
            raise ValueError()
        start, end = [date.fromisoformat(data[key]) for key in ('startDate', 'endDate')]
        now = datetime.now(VANCOUVER)
        if (start.isoformat() != data['startDate'] or end.isoformat() != data['endDate'] or
                not 0 <= (end - start).days <= 92 or end >= now.date()):
            raise ValueError()
    except (TypeError, ValueError):
        return {'error': 'Choose up to 93 completed Vancouver calendar days.'}, 400
    return organic_journey(start, end, now, read_google), 200
