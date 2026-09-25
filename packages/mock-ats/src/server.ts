import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import Fastify from "fastify";

const fixtures = new Set([
  "standard",
  "upload-fail",
  "resume-overwrite",
  "conditional",
  "challenge",
  "changed-question",
  "misleading-banner",
  "disabled-submit",
  "implicit-submit",
]);

export interface MockApplication {
  id: string;
  fixture: string;
  name: string;
  email: string;
  jobId: string;
  receivedAt: string;
}

function page(fixture: string, jobId: string): string {
  const challenge = fixture === "challenge";
  const question =
    fixture === "changed-question"
      ? "Do you need visa sponsorship now?"
      : "Will you need sponsorship in the future?";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Software Engineer | Synthetic Employer</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:740px;margin:2rem auto;padding:0 1rem;color:#17212a}h1{font-size:1.7rem}label{display:block;margin:.8rem 0}input,select,textarea{display:block;width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #89939b;border-radius:3px;font:inherit}input[type=checkbox],input[type=radio]{display:inline;width:auto}button{padding:.6rem 1rem;font:inherit}fieldset{border:0;padding:0}fieldset[hidden],[hidden]{display:none!important}.notice{padding:.6rem;border-left:3px solid #718799;background:#edf2f4}</style></head>
<body><main><p>Synthetic Employer / Careers</p><h1>Software Engineer</h1>
<p data-job-id="${jobId}">Amsterdam, Netherlands</p>
${fixture === "misleading-banner" ? '<p class="notice">Thanks for your interest. Your application has not been sent.</p>' : ""}
${challenge ? '<section data-challenge="captcha" role="alert"><h2>Verification required</h2><p>Complete the local test challenge to continue.</p><button type="button" id="solve">Continue</button></section>' : ""}
<form id="application" method="post" action="/applications" data-fixture="${fixture}" data-job-id="${jobId}"><input type="hidden" name="fixture" value="${fixture}"><input type="hidden" name="job_id" value="${jobId}">
<fieldset id="step-1"><legend>Personal details</legend>
<label for="full-name">Full name<input id="full-name" name="full_name" data-semantic-key="full_name" required maxlength="240" autocomplete="name"></label>
<label for="email">Email<input id="email" name="email" data-semantic-key="email" type="email" required autocomplete="email"></label>
<label for="phone">Phone<input id="phone" name="phone" data-semantic-key="phone" type="tel" required autocomplete="tel"></label>
<label for="location">Country<select id="location" name="country" data-semantic-key="country" required><option value="">Select</option><option value="NL">Netherlands</option><option value="DE">Germany</option></select></label>
<label for="cv">CV<input id="cv" name="cv" data-semantic-key="cv" type="file" accept=".pdf,.docx" required></label>
<output id="upload-status" data-upload-status="idle" aria-live="polite">No file selected</output>
<input name="upload_id" id="upload-id" type="hidden">
<button id="next" type="button">Next</button></fieldset>
<fieldset id="step-2" hidden><legend>Role questions</legend>
<label for="motivation">Motivation<textarea id="motivation" name="motivation" data-semantic-key="motivation" required maxlength="2000"></textarea></label>
<label for="sponsorship">${question}<select id="sponsorship" name="sponsorship" data-semantic-key="sponsorship_required" required><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option></select></label>
<label id="sponsorship-detail" for="sponsorship-detail-input" hidden>Describe sponsorship needs<textarea id="sponsorship-detail-input" name="sponsorship_detail" data-semantic-key="sponsorship_detail"></textarea></label>
<label for="start-date">Available from<input id="start-date" name="available_from" data-semantic-key="available_from" type="date" required></label>
<div role="group" aria-label="Remote preference"><span>Remote preference</span><label><input name="remote_preference" data-semantic-key="remote_preference" type="radio" value="yes" required> Yes</label><label><input name="remote_preference" data-semantic-key="remote_preference" type="radio" value="no" required> No</label></div>
<label for="portfolio">Portfolio<input id="portfolio" name="portfolio" data-semantic-key="portfolio" list="portfolio-options" required></label><datalist id="portfolio-options"><option value="https://portfolio.synthetic.example/a-very-long-but-valid-profile-path"></datalist>
<label for="terms"><input id="terms" name="terms" data-semantic-key="terms" type="checkbox" required> I confirm these details are accurate</label>
<button id="back" type="button">Back</button><button id="submit" type="submit" ${fixture === "disabled-submit" ? "disabled" : ""}>Submit application</button></fieldset>
</form></main><script>
const fixture=${JSON.stringify(fixture)};
const form=document.getElementById('application');
const first=document.getElementById('step-1');const second=document.getElementById('step-2');
document.getElementById('next').addEventListener('click',()=>{first.hidden=true;second.hidden=false;if(fixture==='resume-overwrite')document.getElementById('full-name').value='Parsed Wrong Name';});
document.getElementById('back').addEventListener('click',()=>{second.hidden=true;first.hidden=false;});
document.getElementById('sponsorship').addEventListener('change',e=>{const detail=document.getElementById('sponsorship-detail');detail.hidden=e.target.value!=='yes';detail.querySelector('textarea').required=e.target.value==='yes';});
if(fixture==='implicit-submit')document.getElementById('location').addEventListener('change',()=>HTMLFormElement.prototype.submit.call(form));
document.getElementById('solve')?.addEventListener('click',()=>{document.querySelector('[data-challenge]').hidden=true;});
document.getElementById('cv').addEventListener('change',async e=>{const output=document.getElementById('upload-status');const file=e.target.files?.[0];if(!file)return;output.dataset.uploadStatus='selected';output.textContent='Selected';await new Promise(r=>setTimeout(r,30));output.dataset.uploadStatus='uploading';output.textContent='Uploading';try{const body=new FormData();body.append('file',file);const response=await fetch('/uploads?fixture='+fixture,{method:'POST',body});if(!response.ok)throw new Error('Upload rejected');const result=await response.json();document.getElementById('upload-id').value=result.id;output.dataset.uploadStatus='accepted';output.textContent='Accepted';}catch{output.dataset.uploadStatus='failed';output.textContent='Upload failed';}});
form.addEventListener('submit',e=>{if(!document.getElementById('upload-id').value)e.preventDefault();});
</script></body></html>`;
}

export async function buildMockAts() {
  const app = Fastify({ logger: false, bodyLimit: 6 * 1024 * 1024, trustProxy: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    },
  );
  const submissions: MockApplication[] = [];
  const accounts: Array<{ id: string; email: string }> = [];
  const uploads = new Map<string, { accepted: boolean; filename: string }>();
  app.get("/jobs/:fixture", async (request, reply) => {
    const fixture = (request.params as { fixture: string }).fixture;
    const jobId = (request.query as { jobId?: string }).jobId ?? "synthetic-engineer-1";
    if (!fixtures.has(fixture)) return reply.code(404).send({ error: "Unknown synthetic fixture" });
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(jobId))
      return reply.code(400).send({ error: "Invalid synthetic job ID" });
    return reply.type("text/html; charset=utf-8").send(page(fixture, jobId));
  });
  app.post("/uploads", async (request, reply) => {
    const fixture = (request.query as { fixture?: string }).fixture ?? "standard";
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Missing file" });
    const bytes = await file.toBuffer();
    if (!bytes.length || !/\.(pdf|docx)$/i.test(file.filename))
      return reply.code(400).send({ error: "Unsupported upload" });
    if (fixture === "upload-fail")
      return reply.code(422).send({ error: "Synthetic upload failure" });
    const id = randomUUID();
    uploads.set(id, { accepted: true, filename: file.filename });
    return { id, status: "accepted" };
  });
  app.post("/applications", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const upload = uploads.get(body.upload_id ?? "");
    if (
      !upload?.accepted ||
      !body.full_name?.trim() ||
      !/^\S+@\S+\.\S+$/.test(body.email ?? "") ||
      !body.phone?.trim() ||
      !["NL", "DE"].includes(body.country ?? "") ||
      !body.motivation?.trim() ||
      body.motivation.length > 2000 ||
      !["yes", "no"].includes(body.sponsorship ?? "") ||
      (body.sponsorship === "yes" && !body.sponsorship_detail?.trim()) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.available_from ?? "") ||
      !["yes", "no"].includes(body.remote_preference ?? "") ||
      body.terms !== "on" ||
      !body.portfolio?.startsWith("https://portfolio.synthetic.example/") ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(body.job_id ?? "")
    )
      return reply.code(422).send({ error: "Application fields or upload missing" });
    const record: MockApplication = {
      id: randomUUID(),
      fixture: body.fixture ?? "standard",
      name: body.full_name ?? "",
      email: body.email ?? "",
      jobId: body.job_id ?? "synthetic-engineer-1",
      receivedAt: new Date().toISOString(),
    };
    submissions.push(record);
    return reply.redirect(`/receipts/${record.id}`);
  });
  app.post("/accounts", async (request, reply) => {
    const body = request.body as { email?: string };
    if (!body.email || !/^\S+@\S+\.\S+$/.test(body.email))
      return reply.code(422).send({ error: "Account email missing" });
    const account = { id: randomUUID(), email: body.email };
    accounts.push(account);
    return reply.code(201).send(account);
  });
  app.get("/receipts/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const record = submissions.find((item) => item.id === id);
    if (!record) return reply.code(404).send({ error: "Receipt not found" });
    return reply
      .type("text/html; charset=utf-8")
      .send(
        `<!doctype html><html lang="en"><head><title>Application received</title></head><body><h1>Application received</h1><p data-receipt-id="${record.id}">Software Engineer at Synthetic Employer</p></body></html>`,
      );
  });
  app.get("/__test/records", async () => ({
    count: submissions.length,
    records: [...submissions],
    accountCount: accounts.length,
  }));
  return app;
}

export async function startMockAts() {
  const app = await buildMockAts();
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  return { app, url };
}
