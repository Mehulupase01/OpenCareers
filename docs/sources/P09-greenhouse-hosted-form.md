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

## Adapter Scope

- Bind exact `job-boards.greenhouse.io/{board}/jobs/{id}` origin and URL,
  board token, external job ID, packet, answers and form fingerprint.
- Inspect all required fields and conditional controls before final dispatch.
  Unknown required questions, hidden mandatory controls, challenge/login
  prompts, unsupported upload flows and changed fingerprints stop the job.
- Treat optional demographic answers as absent unless the owner explicitly
  supplies reviewed values. Do not infer sensitive attributes from a CV.
- Accept only a correlated post-submit receipt from the hosted flow. A banner
  alone, transport loss, or a changed destination leaves the attempt unknown.
- Use synthetic fixtures for final-action and response-loss tests. Public
  inspection remains read-only until the private profile, policy and job are
  ready for a real submission.
