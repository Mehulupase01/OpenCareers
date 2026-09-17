import type { ReadPublic } from "./transport.js";

export const readFixture: ReadPublic = async (input, etag) => {
  const url = new URL(input);
  if (etag === '"synthetic-v1"') return { status: 304, body: "", etag, retryAfter: null };
  const ids = [1, 2, 3];
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
