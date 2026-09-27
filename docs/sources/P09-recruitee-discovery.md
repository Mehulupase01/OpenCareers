# P09 Recruitee Discovery Research

Checked 2026-09-27. Recruitee's official Careers Site API documents
`GET https://{tenant}.recruitee.com/api/offers/` as the collection of published
company jobs. It is a single collection endpoint with optional department and tag
filters; OpenCareers requests the complete unfiltered collection and caps it at
10,000 offers and 8 MiB per response.

Primary sources:

- https://docs.recruitee.com/reference/offers
- https://docs.recruitee.com/reference/intro-to-careers-site-api
- https://docs.recruitee.com/reference/authentication-1

The connector constructs only the exact validated tenant subdomain, resolves only
public network addresses, accepts no redirects or arbitrary source URL, and sends
GET without cookies or candidate data. A numeric offer ID is the stable provider
identity. The offer slug is retained as the adapter-compatible target and canonical
URL `https://{tenant}.recruitee.com/o/{slug}`.

A read-only check against `https://freeday.recruitee.com/api/offers/` returned HTTP
200 and four published offers. The page SHA-256 was
`39025ee8722bd2d63fea2b2b3f791a3c634d46d1a1bc380926d86cc885251797`.
Offer `2669462`, slug `forward-deployed-engineer-nl`, normalized to the canonical
tenant URL and retained Rotterdam/NL location evidence. No form, upload, candidate
endpoint or application POST was used.

The official authentication page states that Careers Site API tokens become
mandatory on 10 February 2027. Current public-read support is therefore date-scoped;
token-protected tenants fail as unavailable, and token lifecycle work is required
before support can be claimed beyond that boundary.
