import hashlib
import hmac
import json
import os
from datetime import date, timedelta
from organic_journey import organic_journey_response
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import functions_framework
from flask import jsonify
from winter_report import winter_report

PROPERTY = 'https://starsoccer.ca/'
SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
TOKEN_HASH = os.environ['SEARCH_HQ_TOKEN_SHA256']


def reply(payload, status=200):
    return jsonify(payload), status, {'Cache-Control': 'private, no-store'}


@functions_framework.http
def hello_http(request):
    if request.path != '/' or request.method != 'POST':
        return reply({'error': 'POST to the service root.'}, 405)
    token = request.headers.get('X-Search-HQ-Token', '')
    if not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), TOKEN_HASH):
        return reply({'error': 'Unauthorized'}, 401)
    if request.content_length and request.content_length > 2048:
        return reply({'error': 'Request too large'}, 413)
    journey = organic_journey_response(request.get_json(silent=True))
    if journey is not None:
        return reply(*journey)
    data = request.get_json(silent=True)
    camp = isinstance(data, dict) and data.get('report') == 'winterCamp'
    fields = {'startDate', 'endDate', 'report'} if camp else {'startDate', 'endDate'}
    if not isinstance(data, dict) or set(data) != fields:
        return reply({'error': 'Send startDate and endDate only.'}, 400)
    try:
        start, end = [date.fromisoformat(data[k]) for k in ('startDate', 'endDate')]
        if start > end or end - start > timedelta(days=92) or end > date.today():
            raise ValueError()
    except (ValueError, TypeError):
        return reply({'error': 'Invalid date range. Select at most 93 days.'}, 400)
    if camp:
        return reply(winter_report(start.isoformat(), end.isoformat()))
    metadata = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=' + quote(SCOPE, safe='')
    endpoint = 'https://www.googleapis.com/webmasters/v3/sites/' + quote(PROPERTY, safe='') + '/searchAnalytics/query'
    try:
        with urlopen(Request(metadata, headers={'Metadata-Flavor': 'Google'}), timeout=8) as response:
            access = json.load(response)['access_token']
        body = dict(startDate=start.isoformat(), endDate=end.isoformat(), dimensions=['date'], type='web', aggregationType='byProperty', dataState='final')
        headers = {'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json'}
        with urlopen(Request(endpoint, data=json.dumps(body).encode(), headers=headers), timeout=20) as response:
            result = json.load(response)
        rows = [dict(date=r['keys'][0], clicks=r['clicks'], impressions=r['impressions'], ctr=r['ctr'], position=r['position']) for r in result.get('rows', [])]
        return reply({'property': PROPERTY, 'rows': rows})
    except HTTPError as exc:
        return reply({'error': 'Google rejected the read', 'upstreamStatus': exc.code}, 502)
    except (URLError, TimeoutError, KeyError, ValueError):
        return reply({'error': 'Could not read Search Console data'}, 502)
