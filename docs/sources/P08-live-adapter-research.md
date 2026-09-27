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

Recruitee's official Careers Site API is explicitly intended to let candidates
view jobs and apply. Its documented candidate endpoint accepts multipart identity,
CV, cover letter and screening answers, returns HTTP 201 with a server-side
candidate ID, and triggers the same confirmation email as a hosted application.
The documentation also warns that required screening questions can be omitted by
an API client, so OpenCareers treats every required published question as mandatory
and will not exploit that server-side gap. Sources:
https://docs.recruitee.com/reference/intro-to-careers-site-api
https://docs.recruitee.com/reference/offersoffer_idcandidates

The public Freeday `software-engineer-3` offer was read through Recruitee's GET
endpoint on 2026-09-27. It was published and exposed required phone and CV fields,
an optional cover letter, one Rotterdam location and no custom open questions.
This established a current read-only adapter fixture; no candidate data, upload or
POST was sent. The role requires the candidate to be based in the Netherlands and
work from the Rotterdam office regularly, so it cannot become the live canary until
the private reviewed profile and standing policy prove those facts. Source:
https://freeday.recruitee.com/o/software-engineer-3

As of the same check, Recruitee documents a Careers Site token requirement taking
effect on 10 February 2027. The adapter accepts no arbitrary host or credential and
does not assume employer-issued access. Token lifecycle support must be added before
claiming compatibility with a token-protected tenant. Source:
https://docs.recruitee.com/reference/authentication-1
