# Star Soccer Search HQ

This Cloud Run function reads daily Search Console totals for `https://starsoccer.ca/`. The dashboard calls it with `POST /`, an `X-Search-HQ-Token` header and a JSON body containing `startDate` and `endDate`.

Use Google Cloud buildpacks with build context `services/search-hq` and function target `hello_http`. The production service is `star-soccer-search-hq` in `us-west1`. Restrict the main-branch trigger to changes under `services/search-hq/**`.

The runtime requires `SEARCH_HQ_TOKEN_SHA256`, the lowercase hexadecimal SHA-256 digest of the dashboard token. Keep the token and its production digest outside Git. The Cloud Run service identity needs read access to the Search Console property.
