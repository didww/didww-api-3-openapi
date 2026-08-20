# DIDWW OpenAPI Specification

This repository contains the [OpenAPI specification][openapi] for the [DIDWW API v3][docs] — the
JSON:API interface to the DIDWW platform: browse coverage, order and manage DIDs, route them to
voice trunks, and reserve numbers before purchase.

The document is not written by hand. It is generated from an integration test suite that drives the
live endpoints: every request body, response body and status code it describes is exercised against
a running API on every build, and a response that stops matching its documented schema fails that
build. What you read here is what the API answered.

## Directory structure

| Path | Description |
|------|-------------|
| [`/openapi/`](./openapi/) | The OpenAPI 3.0 document, in JSON and YAML |
| [`VERSION`](./VERSION) | The API version the current document describes |
| [`RELEASING.md`](./RELEASING.md) | How a new version is published here |

## Files

| File | Description |
|------|-------------|
| [`openapi/v3_api.json`](./openapi/v3_api.json) | OpenAPI 3.0.3 document, JSON |
| [`openapi/v3_api.yaml`](./openapi/v3_api.yaml) | The same document, YAML |

Both files are generated from the same source and describe exactly the same API; CI fails if they
ever diverge. Pick whichever format your tooling prefers.

The paths above are stable — every release updates these files in place, so a tool can point at a
raw URL once and keep getting the current document:

```
https://raw.githubusercontent.com/didww/didww-api-3-openapi/main/openapi/v3_api.json
https://raw.githubusercontent.com/didww/didww-api-3-openapi/main/openapi/v3_api.yaml
```

To pin to a specific API version, replace `main` with that version's tag (for example
`2026-04-16`).

## API versions

DIDWW API v3 is versioned by release date. A client picks a version per request with the
`X-DIDWW-Api-Version` header; without it, the API serves the version configured for the API key's
customer.

**This repository tracks one version: the latest one released to production.** It is named in
[`VERSION`](./VERSION) and in the document's `info.version`, and it is the default of the
`X-DIDWW-Api-Version` parameter throughout the document. Each release is committed and tagged with
its version date, so earlier documents stay reachable through the repository's tags and
[releases](https://github.com/didww/didww-api-3-openapi/releases).

Note that the newest version *announced* in the API documentation may be ahead of the one described
here: a version appears in this repository once it is the one customers are actually served.

## Authentication and environments

Every request carries an `api-key` header — the key issued to the customer in the DIDWW user panel.
See [API keys][api-keys] in the documentation.

| Environment | Base URL |
|-------------|----------|
| Production | `https://api.didww.com/v3` |
| Sandbox | `https://sandbox-api.didww.com/v3` |

Both are declared as `servers` in the document, so a client generated from it can be pointed at the
sandbox without editing the base URL by hand.

## What the document covers

Every collection and member endpoint the documented version serves, with its query parameters,
request bodies, responses and error shapes — coverage, DIDs and DID groups, orders and reservations,
voice IN/OUT trunks, capacity, identities and regulation (addresses, proofs, requirements,
verifications), emergency services, exports and account balance.

The schemas are strict: a resource object enumerates its full attribute and relationship set, and an
undocumented key appearing in a response is treated as a defect rather than tolerated.

### Deliberately left out

- **Relationship endpoints** — `/{type}/{id}/relationships/{name}` and `/{type}/{id}/{name}`. They
  more than double the size of the document to describe what a reader can already derive from the
  `links.self` and `links.related` members the resource objects carry.
- **Non-JSON:API file downloads** — `GET /exports/{id}.csv.gz` returns a gzipped CSV rather than a
  JSON:API document.
- **`PUT` as an alias of `PATCH`** — updates are documented as `PATCH`, the verb JSON:API defines.
  The API also answers `PUT` on the same paths, but nothing new is reachable through it.
- **Types the documented version does not serve** — types removed at this version, and types
  introduced by a later, not-yet-released one.
- **Relationships outside the API's fetchable set**, and a small number of attributes gated on
  per-account features that most callers cannot use.

## Using the specification

The document is plain OpenAPI 3.0.3 with no vendor extensions, so standard tooling works as-is:

- render it — [Redocly][redocly], Swagger UI, Scalar, or your IDE's OpenAPI viewer;
- generate a client — [openapi-generator][openapi-generator] and similar (see the ready-made SDKs
  below before generating your own);
- import it into Postman, Insomnia or Bruno as a request collection;
- run a mock server against it — [Prism][prism];
- lint or diff it in CI to catch breaking changes before they reach you.

## Related

- [DIDWW API documentation][docs] — the narrative reference, including the version history
- [Postman collections](https://github.com/didww/didww-api3-postman)
- SDKs: [Ruby](https://github.com/didww/didww-v3-ruby) ·
  [Python](https://github.com/didww/didww-api-3-python-sdk) ·
  [PHP](https://github.com/didww/didww-api-3-php-sdk) ·
  [Java](https://github.com/didww/didww-api-3-java-sdk) ·
  [Go](https://github.com/didww/didww-api-3-go-sdk) ·
  [TypeScript](https://github.com/didww/didww-api-3-typescript-sdk) ·
  [.NET](https://github.com/didww/didww-api-3-dotnet-sdk)

## Feedback

The document is generated, so it is not edited here: a mistake in it is a mistake in the generator
or in the API itself. Open an issue describing what you expected and what the API actually answered,
or contact [support@didww.com](mailto:support@didww.com).

## License

[MIT](./LICENSE)

[openapi]: https://spec.openapis.org/oas/v3.0.3
[docs]: https://doc.didww.com/api3/index.html
[api-keys]: https://doc.didww.com/api3/index.html#api-keys
[redocly]: https://redocly.com/docs/cli/
[openapi-generator]: https://openapi-generator.tech/
[prism]: https://stoplight.io/open-source/prism
