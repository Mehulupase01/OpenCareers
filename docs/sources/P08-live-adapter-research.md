# P08 First Live Adapter Research

Checked 2026-09-27. This is access-path research, not live application evidence.

Greenhouse's Job Board `POST /v1/boards/{board_token}/jobs/{id}` requires an
employer-issued API key and its own documentation recommends the embedded form.
It does not validate missing required fields for custom API clients. A public
GET listing connector therefore grants no authority or credentials for direct
application POSTs. Source:
https://github.com/grnhse/greenhouse-api-docs/blob/master/source/includes/job-board/_applications.md

Lever's Postings API documents a custom application POST, rate limits, and
company-site API context. It also states that custom questions are not exposed
by that API, while each posting provides a hosted `applyUrl`. A candidate-side
adapter should start with the public hosted form, inspect the exact questions
and origin, and fail closed on unsupported variants. Source:
https://github.com/lever/postings-api/blob/master/README.md

Public Netherlands examples include Protolabs' Senior Python Developer
(Backend) and other software roles on Lever. These are possible adapter
fixtures, not claims that the owner is eligible or has applied. Source:
https://jobs.lever.co/protolabs/c0ed06dd-6b46-4f22-a648-f57fa6807b25

The first live adapter will not request employer API keys, bypass challenges,
scrape restricted logged-in surfaces, or submit synthetic candidate data to an
employer. A private reviewed candidate profile, current standing policy,
appropriate vacancy and receipt evidence remain prerequisites for P08-G6.

The Protolabs hosted form was inspected read-only with an isolated browser on
2026-09-27. It currently has a required location autocomplete, conditional
referral question, right-to-work and salary questions, four senior-backend
experience prompts, privacy consent controls and an hCaptcha field. No form
POST, upload or submission was made. This exact variant is **unsupported**
until its substantive answers have reviewed evidence and any verification
challenge is handled through an allowed path. Inspection alone is not dry-run
or live submission support.
