import Fastify from "fastify";

export interface HandoffFixture {
  url: string;
  close(): Promise<void>;
  /** Server-side truth: how many final application actions actually arrived. */
  finalActionAttempts(): number;
  /** Requests the browser attempted to send off-origin. */
  offsiteAttempts(): number;
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Hosted application | Synthetic Portal</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}
label{display:block;margin:.8rem 0}input,textarea{display:block;width:100%;padding:.5rem}
[hidden]{display:none!important}</style></head>
<body><h1>Machine Learning Engineer</h1>
<p>Synthetic Portal hosted application form, loopback only.</p>
<section data-challenge="captcha" role="alert"><h2>Verification required</h2>
<p>Confirm you are a person to continue.</p>
<button type="button" id="verify">I am not a robot</button></section>
<form id="application" method="post" action="/forms/submit">
<label for="full-name">Full name<input id="full-name" name="full_name" required></label>
<label for="email">Email<input id="email" name="email" type="email" required></label>
<label for="motivation">Motivation<textarea id="motivation" name="motivation" required></textarea></label>
<button id="submit" type="submit">Submit application</button></form>
<script>
document.getElementById('verify').addEventListener('click',()=>{
  document.querySelector('[data-challenge]').hidden=true;
  document.getElementById('submit').disabled=false;
});
</script></body></html>`;

/**
 * A loopback stand-in for a challenged hosted application form. It exists so the
 * external-adapter handoff path can be proven end to end without any employer
 * being contacted: it serves a challenge, a form whose submit is a declared
 * final action, and counters that know what actually arrived.
 */
export async function startHandoffFixture(): Promise<HandoffFixture> {
  let finalActions = 0;
  const offsite: string[] = [];
  const app = Fastify({ logger: false, trustProxy: false });
  app.post("/forms/submit", async (_request, reply) => {
    finalActions += 1;
    return reply.code(201).send({ ok: true });
  });
  app.post("/__test/offsite", async (request, reply) => {
    const { url } = (request.body ?? {}) as { url?: string };
    if (url) offsite.push(url);
    return reply.code(204).send();
  });
  app.get("/jobs/hosted", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(PAGE),
  );
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  return {
    url,
    close: () => app.close(),
    finalActionAttempts: () => finalActions,
    offsiteAttempts: () => offsite.length,
  };
}
