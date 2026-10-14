# DIDWW OpenAPI Specification

This repository contains the [OpenAPI specification][openapi] for the [DIDWW API v3][docs] — the
JSON:API interface to the DIDWW platform: browse coverage, order and manage DIDs, route them to
voice and SMS trunks, reserve numbers before purchase, and read the prices of the account's Voice IN,
Voice OUT and SMS plans.

The document is not written by hand. It is generated from the integration test suites that drive the
live endpoints, one suite per DIDWW service: every request body, response body and status code it
describes is exercised against a running API every time a service's suite runs, and a response that
stops matching its documented schema fails that run. What you read here is what the API answered.

## Directory structure

| Path | Description |
|------|-------------|
| [`/openapi/`](./openapi/) | The OpenAPI 3.0 document, in JSON and YAML |
| [`/openapi/sources/`](./openapi/sources/) | The generated source of each service the document is built from |
| [`VERSION`](./VERSION) | The API version the current document describes |
| [`RELEASING.md`](./RELEASING.md) | How a new version is published here |

## Files

| File | Description |
|------|-------------|
| [`openapi/v3_api.json`](./openapi/v3_api.json) | OpenAPI 3.0.3 document, JSON |
| [`openapi/v3_api.yaml`](./openapi/v3_api.yaml) | The same document, YAML |

Both files are built from the same sources and describe exactly the same API; CI fails if they ever
diverge. Pick whichever format your tooling prefers.

The paths above are stable — every release updates these files in place, so a tool can point at a
raw URL once and keep getting the current document:

```
https://raw.githubusercontent.com/didww/didww-api-3-openapi/main/openapi/v3_api.json
https://raw.githubusercontent.com/didww/didww-api-3-openapi/main/openapi/v3_api.yaml
```

To pin to a specific API version, replace `main` with that version's tag (for example
`2026-04-16`).

## API versions

DIDWW API v3 is versioned by release date. A request carrying an access token is served the
version named by the token's `api_version` claim — the version requested in the `api_version` field
of `POST /token`, else the default version configured for the account — but never one older than
`2026-10-22` or than the account's default. It never reads the `X-DIDWW-Api-Version` header.
Versions released before `2026-10-22` are reached with the `api-key` header instead, the version
picked by `X-DIDWW-Api-Version` (never older than the account's default), else the account's
default; a key request that resolves to `2026-10-22` or later is refused with 401. The documents of
those versions, under their tags, describe that scheme.

**`main` tracks one version: the latest one released to production.** It is named in
[`VERSION`](./VERSION) and in the document's `info.version`. Each release is committed and tagged
with its version date, so earlier documents stay reachable through the repository's tags and
[releases](https://github.com/didww/didww-api-3-openapi/releases).

Note that the newest version *announced* in the API documentation may be ahead of the one described
on `main`: a version appears there once it is the one customers are actually served.

## Authentication and environments

Requests are authenticated with a short-lived bearer access token, `Authorization: Bearer <token>`;
two operations are the exception, as noted below the table. A token is minted with `POST /token` on
the token service of the environment being called, in exchange for an API key issued in the DIDWW
user panel (see [API keys][api-keys] in the documentation):

```bash
curl https://auth.didww.com/token \
  -H 'Api-Key: <your API key>' \
  -H 'Content-Type: application/json' \
  -d '{"aud": ["api.didww.com", "api-vin.didww.com"], "api_version": "2026-10-22"}'
```

The answer carries the token in `access_token`, its lifetime in seconds in `expires_in`, and the
audiences, scope and API version it was minted for. Mint a new one when it expires.

- **Audience.** A token is accepted only by the services its `aud` lists. Each service's audience is
  its production host name, on the production and on the sandbox host alike; mint one token per
  service, or one token listing every service you call.
- **Scope.** A token minted with `"scope": "read"` can only read: every other method is refused with
  403 and an `insufficient_scope` challenge. The prices operations only read.
- **Environment.** A token is minted with an API key of the environment it will call, on that
  environment's token service; a token minted in one environment is refused by the other.

| Service | Production | Sandbox | Audience (`aud`) |
|---------|------------|---------|------------------|
| Token service | `https://auth.didww.com/token` | `https://auth-sandbox.didww.com/token` | — |
| DIDWW API | `https://api.didww.com/v3` | `https://sandbox-api.didww.com/v3` | `api.didww.com` |
| Voice IN Rates | `https://api-vin.didww.com/v3` | `https://api-vin-sandbox.didww.com/v3` | `api-vin.didww.com` |
| Voice OUT Rates | `https://api-vout.didww.com/v3` | `https://api-vout-sandbox.didww.com/v3` | `api-vout.didww.com` |
| SMS Rates | `https://api-sms.didww.com/v3` | `https://api-sms-sandbox.didww.com/v3` | `api-sms.didww.com` |

One operation also accepts the `api-key` header in place of a token: the export download
(`GET /exports/{filename}.csv.gz`), which is reached through the URL a completed export reports.
One needs no authentication at all: `GET /public_keys`, the keys regulation documents are encrypted
with before upload.

### Servers

The document's root `servers` are the Production and Sandbox base URLs of `api.didww.com`, so a
client generated from it can be pointed at the sandbox without editing the base URL by hand. The
prices paths are served by other hosts and declare their own path-level `servers`:

- the SMS prices paths (`/sms_out/a2p/…`, `/sms_out/p2p/…`, `/sms_out/otp/…`, `/sms_in/…`) name the
  SMS Rates hosts;
- `/prices.csv.gz` and `/lookup/prices` are served by both Voice IN Rates and Voice OUT Rates, so
  their servers are the templates `https://{service}.didww.com/v3` and
  `https://{service}-sandbox.didww.com/v3`, where the `service` variable is `api-vin` (the default)
  or `api-vout`. Set it to the service whose prices you want; where the two services describe an
  operation differently, the description gives each service's text under a heading naming the
  `service` value and the service, as **api-vin — Voice IN Rates**.

## What the document covers

Every collection and member endpoint the documented version serves, with its query parameters,
request bodies, responses and error shapes — coverage, DIDs and DID groups, orders and reservations,
inbound and outbound voice trunks, SMS trunks and trunk groups, capacity, identities and regulation
(addresses, proofs, requirements, verifications), emergency services, exports and their file
download, account balance, and the price files and price lookups of the Voice IN, Voice OUT and SMS
plans.

The schemas are strict: a resource object enumerates its full attribute and relationship set, and an
undocumented key appearing in a response is treated as a defect rather than tolerated.

### Deliberately left out

- **Relationship endpoints** — `/{type}/{id}/relationships/{name}` and `/{type}/{id}/{name}`. They
  more than double the size of the document to describe what a reader can already derive from the
  `links.self` and `links.related` members the resource objects carry.
- **`PUT` as an alias of `PATCH`** — updates are documented as `PATCH`, the verb JSON:API defines.
  The API also answers `PUT` on the same paths, but nothing new is reachable through it.
- **Types the documented version does not serve** — types removed at this version, and types
  introduced by a later, not-yet-released one.
- **Relationships outside the API's fetchable set**, and a small number of attributes gated on
  per-account features that most callers cannot use.
- **The token endpoint** — `POST /token` is served by the token service rather than by an API host,
  and is described under [Authentication and environments](#authentication-and-environments) above.

## Using the specification

The document is plain OpenAPI 3.0.3 with no vendor extensions, so standard tooling works as-is:

- render it — [Redocly][redocly], Swagger UI, Scalar, or your IDE's OpenAPI viewer;
- generate a client — [openapi-generator][openapi-generator] and similar (see the ready-made SDKs
  below before generating your own);
- import it into Postman, Insomnia or Bruno as a request collection;
- run a mock server against it — [Prism][prism];
- lint or diff it in CI to catch breaking changes before they reach you.

Support for path-level `servers` and for server variables varies between generators and tools: some
send every request to the root server, or ignore the `service` variable. Check that a client
generated from the document calls the prices operations on their own hosts.

## Sources

The published document is built from one source per service: each DIDWW service generates its
own source from its integration suite into [`openapi/sources/`](./openapi/sources/) — `api.json`,
`voice_in.json`, `voice_out.json`, `sms.json` — and `scripts/build.mjs` assembles them into
`openapi/v3_api.json` and `openapi/v3_api.yaml`, failing when the sources disagree. `main` holds the
version customers are served; `prerelease` holds the next version while it is prepared, and is merged
into `main` when that version is released. [`RELEASING.md`](./RELEASING.md) describes both branches
and how a source is added.

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

The document is generated, so it is not edited here: a mistake in it is a mistake in the generating
suite of a service or in the API itself. Open an issue describing what you expected and what the API
actually answered, or contact [support@didww.com](mailto:support@didww.com).

## License

[MIT](./LICENSE)

[openapi]: https://spec.openapis.org/oas/v3.0.3
[docs]: https://doc.didww.com/api3/index.html
[api-keys]: https://doc.didww.com/api3/index.html#api-keys
[redocly]: https://redocly.com/docs/cli/
[openapi-generator]: https://openapi-generator.tech/
[prism]: https://stoplight.io/open-source/prism
