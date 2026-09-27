# P09 Greenhouse Hosted Form Research

Checked 2026-09-27. This is public, read-only inspection, not an application
submission or a supported adapter claim.

## Decision

Greenhouse hosted external job forms are the second real portal family to
implement in the P09 SDK. The owner corpus has no reviewed private profile or
live source ranking yet, so this is a feasibility choice. Re-rank when that
corpus exists.

Greenhouse's [Job Board API](https://docs.greenhouse.io/job-board.html) says
public GET endpoints require no authentication, while application POST requires
Basic Auth with an employer-provided Job Board API key. A candidate-side adapter
must not assume possession of that key. The public hosted form is the intended
candidate-facing path for this variant. Lever's
[Postings API](https://github.com/lever/postings-api/blob/master/README.md)
also documents an application key and rate limits for custom apply endpoints;
its hosted forms remain an alternative family after Greenhouse.

## Observed Variant

The [Adyen Amsterdam software engineer posting](https://job-boards.greenhouse.io/adyen/jobs/7342890)
was open for public read-only inspection on 2026-09-27. The rendered application
has first/last name, email, optional phone, required CV, optional cover letter,
a required visa/relocation support question, an optional demographic survey,
and a final Submit application button. No final action was taken. The rendered
text did not show a challenge widget, which is not proof one will never appear.
An isolated Playwright DOM read found one form and no iframes. The core inputs
had stable IDs (`first_name`, `last_name`, `email`, `resume`); the required
visa/relocation textarea used a `question_<numeric-id>` ID. The inputs had no
`name` attributes and their native `required` properties were false even when
the visible labels showed `*`. The inspector therefore needs visible label and
control association, not only HTML attributes, and must stop on ambiguity.
The first read-only inspector run found 17 controls and five required controls:
`first_name`, `last_name`, `email`, `resume`, and the visa/relocation question.
Its structural SHA-256 was
`576ddd3c9bb6278fca1986dca86ed7793c417293491deb6be71bdea1239b698c`.
This dated fingerprint is observation evidence, not a permanent allowlist.
A GET-only preparation using a synthetic packet on the same date found the same
17 controls, no attempted writes, no visible challenge, and one unresolved
mandatory employer question. It returned `needs_input`; no CV upload or final
action occurred.
Further isolated browser inspection after hydration showed a reCAPTCHA
Enterprise script and iframe. A synthetic-data final-click trace intercepted
every write and observed a CV upload POST to a Greenhouse S3 endpoint, a
reCAPTCHA Enterprise reload POST, then an application POST to
`boards.greenhouse.io`. No file or application reached those endpoints.
This Adyen variant is `challenge` at preparation. An answer-complete form
without a challenge remains `unsupported` until server-accepted upload and
correlated receipt handling are implemented and verified.

## Adapter Scope

- Bind exact `job-boards.greenhouse.io/{board}/jobs/{id}` origin and URL,
  board token, external job ID, packet, answers and form fingerprint.
- Inspect all required fields and conditional controls before final dispatch.
  Unknown required questions, hidden mandatory controls, challenge/login
  prompts, unsupported upload flows and changed fingerprints stop the job.
- Use the packet's reviewed identity and CV. A two-part full name can be split
  for first/last fields; other names need explicit approved parts whose joined
  value matches the reviewed full name. Employer questions need a validated
  packet answer or explicit approved value.
- Treat optional demographic answers as absent unless the owner explicitly
  supplies reviewed values. Do not infer sensitive attributes from a CV.
- Accept only a correlated post-submit receipt from the hosted flow. A banner
  alone, transport loss, or a changed destination leaves the attempt unknown.
- Use synthetic fixtures for final-action and response-loss tests. Public
  inspection remains read-only until the private profile, policy and job are
  ready for a real submission.

## Inspection And Receipt Limits

The browser fixture now treats an invisible required conditional control as an
unsupported form and includes its identity in the structural fingerprint. A
later form inspection cannot silently equate that structure with a prior
visible-only preparation. This is a conservative stop; it does not establish
that the hosted upload or final submission path works.

Greenhouse [allows each employer to customize the application confirmation
page](https://support.greenhouse.io/hc/en-us/articles/115005516483-Edit-application-confirmation-page).
Its visible text alone is therefore not a portable, correlated receipt. The
Greenhouse adapter must remain provisional until a variant-specific receipt
can be tied to the exact posting and candidate without relying on a banner.

The synthetic preparation fixture now fills only a matching, challenge-free
form under the read-only write barrier. It reads each field back, checks the
selected CV bytes against the packet hash, and reports page-side mutation or
file rejection. Selection is not server upload acceptance. Even a clean fill
remains `unsupported`, and no Greenhouse submit task is queued.
