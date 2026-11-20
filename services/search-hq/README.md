# Star Soccer Search HQ

This Cloud Run function reads daily Search Console totals for `https://starsoccer.ca/`. The dashboard calls it with `POST /`, an `X-Search-HQ-Token` header and a JSON body containing `startDate` and `endDate`.

Use Google Cloud buildpacks with build context `services/search-hq` and function target `hello_http`. The production service is `star-soccer-search-hq` in `us-west1`. Restrict the main-branch trigger to changes under `services/search-hq/**`.

The runtime requires `SEARCH_HQ_TOKEN_SHA256`, the lowercase hexadecimal SHA-256 digest of the dashboard token. Keep the token and its production digest outside Git. The Cloud Run service identity needs read access to the Search Console property.

### Weekly registration journey

Send `{"report":"organicJourney","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}` to the same authenticated route. The Cloud Run service identity needs read access to GA4 property `565135484`. The response echoes the report, site property and inclusive dates.

- `sessions` counts Google organic sessions on starsoccer.ca. `convertedSessions` counts those with an accepted registration on a supported player form. Multiple player submissions in one visit contribute one converted session.
- `formViews` lists `{path,sessions}` for weekly training, Christmas Camp, Boxing Week Camp and Pro-D Camp registration pages. Each count includes sessions from all channels that viewed that form anywhere in the visit. A session may view several forms.
- The named synthetic campaign `search_hq_test` is excluded from the business measures. GA4 cannot identify an untagged test from its event alone.
- A null measure and its `reason` identify insufficient coverage, including privacy thresholding and incompatible reporting-day boundaries. Dates use Vancouver time. The report allows 48 hours after the last day for GA4 processing and checks daily page-view coverage. Organic traffic is measurable from the first full tracking day on November 19, 2026. Accepted-registration sessions are measurable from November 20.
