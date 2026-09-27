# P05 OpenRouter Live Route Check

Checked 2026-09-27 using the owner's private local `.env`. Secret values were
not printed or committed. Only model metadata and synthetic prompts were sent;
no candidate profile, CV, vacancy, or employer data was sent.

The live `/api/v1/models` response includes `total_count` and `links` alongside
`data`. The former strict parser rejected that response. The contract now
accepts the typed pagination metadata and still rejects unknown top-level
fields. The catalogue lists `nvidia/nemotron-3-super-120b-a12b:free` and
`nvidia/nemotron-3-ultra-550b-a55b:free` with zero prompt and completion
prices. Super advertises strict structured output; Ultra does not advertise
`response_format` and must not be selected for the strict matching route.

A synthetic Super completion with provider `nvidia`, `zdr: true` and
`data_collection: deny` returned HTTP 404. The route is not presently usable
under that privacy policy. A synthetic Super structured request and a
synthetic Ultra prose request without those privacy filters each returned
HTTP 200. OpenRouter returned provider display name `Nvidia`, so the transport
now accepts a case-only display difference but still rejects another provider.
This confirms technical connectivity, not production quality or permission to
send private candidate facts.

The owner opted to consider a reviewed free provider for minimized career
facts. [NVIDIA API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)
exclude personal data unless expressly permitted by a specific API service.
Therefore no real candidate-data route has been enabled. The exposed key
previously pasted into chat should be rotated; the local `.env` is ignored by
Git and the key is not committed. P05 authenticated private-inference
reliability remains open.
