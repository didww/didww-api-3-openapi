# OpenAPI documents

| File | Description |
|------|-------------|
| `v3_api.json` | OpenAPI 3.0.3 document for the DIDWW API v3, JSON |
| `v3_api.yaml` | The same document, YAML |
| `sources/` | One generated document per DIDWW service the API spans, each produced by that service's own integration suite |

Both published files describe the same API version, named in [`../VERSION`](../VERSION) and in
`info.version`: on `main` the latest one released to production, on `prerelease` the version being
prepared. They are built from `sources/` by
`scripts/build.mjs`; CI rebuilds them, checks that the committed files match the build and that the
two formats agree. See [`../RELEASING.md`](../RELEASING.md) for how a source is added or regenerated.

These paths are stable across releases: each release overwrites the files in place and tags the
commit with the API version date. See the [repository README](../README.md) for raw URLs, version
selection and what the document deliberately leaves out.
