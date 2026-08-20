# OpenAPI documents

| File | Description |
|------|-------------|
| `v3_api.json` | OpenAPI 3.0.3 document for the DIDWW API v3, JSON |
| `v3_api.yaml` | The same document, YAML |

Both files describe the same API version — the latest one released to production, named in
[`../VERSION`](../VERSION) and in `info.version`. They are generated from one source and validated
against each other in CI.

These paths are stable across releases: each release overwrites the files in place and tags the
commit with the API version date. See the [repository README](../README.md) for raw URLs, version
selection and what the document deliberately leaves out.
