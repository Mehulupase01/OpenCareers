import type { ReadPublic } from "./transport.js";

export const readFixture: ReadPublic = async (input, etag) => {
  const url = new URL(input);
  if (etag === '"synthetic-v1"') return { status: 304, body: "", etag, retryAfter: null };
  const ids = [1, 2, 3];
  if (url.hostname.includes(".jobs.personio."))
    return {
      status: 200,
      etag: null,
      retryAfter: null,
      body: `<?xml version="1.0" encoding="UTF-8"?><workzag-jobs>${ids
        .map(
          (id) =>
            `<position><id>${300 + id}</id><name>Personio Software Engineer ${id}</name><office>Amsterdam, Netherlands</office><jobDescriptions><jobDescription><name>Responsibilities</name><value><![CDATA[<p>Build reliable synthetic services in TypeScript. Fixture vacancy only.</p>]]></value></jobDescription></jobDescriptions><createdAt>2026-10-10T12:00:00Z</createdAt></position>`,
        )
        .join("")}</workzag-jobs>`,
    };
  const body =
    url.hostname === "boards-api.greenhouse.io"
      ? {
          jobs: ids.map((id) => ({
            id,
            internal_job_id: 100 + id,
            title: `Software Engineer ${id}`,
            location: { name: "Amsterdam, Netherlands" },
            content:
              "<p>Build and test reliable synthetic services with Python. Fixture vacancy only.</p>",
            updated_at: "2026-09-16T10:00:00Z",
          })),
          meta: { total: 3 },
        }
      : url.hostname === "api.ashbyhq.com"
        ? {
            apiVersion: "1",
            jobs: ids.map((id) => ({
              title: `Ashby Software Engineer ${id}`,
              location: "Amsterdam, Netherlands",
              jobUrl: `https://jobs.ashbyhq.com/${url.pathname.split("/").at(-1)}/synthetic-${id}`,
              isListed: true,
              workplaceType: "Hybrid",
              descriptionPlain:
                "Build and test reliable synthetic services with TypeScript. Fixture vacancy only.",
              publishedAt: "2026-10-10T12:00:00Z",
              address: { postalAddress: { addressCountry: "NLD" } },
            })),
          }
        : url.hostname.endsWith(".recruitee.com")
          ? {
              offers: ids.map((id) => ({
                id: 200 + id,
                slug: `synthetic-engineer-${id}`,
                title: `Platform Engineer ${id}`,
                status: "published",
                location: "Rotterdam, Netherlands",
                country_code: "NL",
                description:
                  "Build and test reliable synthetic platform services. Fixture vacancy only.",
                requirements: "Use TypeScript and careful operational practices.",
                published_at: "2026-09-16T10:00:00Z",
                updated_at: "2026-09-16T11:00:00Z",
                hybrid: true,
              })),
            }
          : Number(url.searchParams.get("skip")) === 0
            ? ids.map((id) => ({
                id: `synthetic-${id}`,
                text: `Data Engineer ${id}`,
                categories: { location: "Amsterdam" },
                country: "NL",
                descriptionPlain:
                  "Build and test reliable synthetic data services. Fixture vacancy only.",
                workplaceType: "hybrid",
              }))
            : [];
  return { status: 200, body: JSON.stringify(body), etag: '"synthetic-v1"', retryAfter: null };
};
