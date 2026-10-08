import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BuildError, buildDocument, canonical } from '../scripts/build.mjs';

import { VERSION, error, mainSource, serviceSource, voiceIn, voiceOut } from './fixtures.mjs';

const build = (sources) => buildDocument(sources, VERSION);
const rejects = (sources, pattern) => assert.throws(() => build(sources), (e) => e instanceof BuildError && pattern.test(e.message));
const family = () => ({ api: mainSource(), voice_in: voiceIn(), voice_out: voiceOut() });
const lookup = (doc) => doc.paths['/lookup/prices'].get;
const resourceOf = (source) => Object.values(source.components.schemas).find((schema) => schema.properties?.attributes);
const collectionOf = (source) => Object.values(source.components.schemas).find((schema) => schema.properties?.data);
const apiKeyMain = () => {
  const main = mainSource();
  main.components.securitySchemes = { api_key: { type: 'apiKey', in: 'header', name: 'api-key' } };
  main.security = [{ api_key: [] }];
  return main;
};

describe('a build of the main source alone', () => {
  it('reproduces the main source canonically', () => {
    const source = JSON.parse(readFileSync(new URL('../openapi/sources/api.json', import.meta.url), 'utf8'));
    const doc = buildDocument({ api: source }, source.info.version);
    assert.deepEqual(canonical(doc), canonical(source));
  });
});

describe('a path served by one service source', () => {
  it('gets the source servers on the path item and its security on each operation when the main source differs', () => {
    const doc = build({ api: apiKeyMain(), voice_in: voiceIn() });
    const item = doc.paths['/lookup/prices'];
    assert.equal(item.servers[0].url, 'https://api-vin.didww.com/v3');
    assert.equal(item.servers[1].url, 'https://api-vin-sandbox.didww.com/v3');
    assert.deepEqual(item.get.security, [{ bearer_token: [] }]);
    assert.equal(doc.paths['/balance'].servers, undefined);
  });

  it('adds no operation-level security when the source enforces what the main source does', () => {
    const doc = build({ api: mainSource(), voice_in: voiceIn() });
    assert.equal(lookup(doc).security, undefined);
  });

  it("keeps an operation's own security", () => {
    const vin = voiceIn();
    lookup(vin).security = [];
    const doc = build({ api: apiKeyMain(), voice_in: vin });
    assert.deepEqual(lookup(doc).security, []);
  });

  it('takes the root fields from the main source', () => {
    const main = apiKeyMain();
    const doc = build({ api: main, voice_in: voiceIn(), voice_out: voiceOut() });
    assert.deepEqual(doc.servers, main.servers);
    assert.deepEqual(doc.security, main.security);
    assert.deepEqual(doc.info, main.info);
    assert.deepEqual(doc.externalDocs, main.externalDocs);
  });
});

describe('a path served by two service sources', () => {
  const doc = build(family());
  const item = doc.paths['/lookup/prices'];

  it('carries the host as a server variable', () => {
    assert.equal(item.servers[0].url, 'https://{service}.didww.com/v3');
    assert.equal(item.servers[1].url, 'https://{service}-sandbox.didww.com/v3');
    assert.deepEqual(item.servers[0].variables.service.enum, ['api-vin', 'api-vout']);
    assert.equal(item.servers[0].variables.service.default, 'api-vin');
  });

  it('names the services in the variable and the environments in the servers', () => {
    assert.equal(item.servers[0].description, 'Production');
    assert.equal(item.servers[1].description, 'Sandbox');
    assert.equal(item.servers[0].variables.service.description, 'api-vin — Voice IN Rates; api-vout — Voice OUT Rates');
    assert.deepEqual(item.servers[1].variables, item.servers[0].variables);
  });

  it('orders the services by the load order whatever order the sources come in', () => {
    const shuffled = build({ voice_out: voiceOut(), api: mainSource(), voice_in: voiceIn() });
    assert.deepEqual(shuffled.paths['/lookup/prices'].servers[0].variables.service.enum, ['api-vin', 'api-vout']);
    assert.match(lookup(shuffled).description, /^\*\*api-vin — /);
  });

  it('keeps differing prose per service and identical prose once', () => {
    assert.match(item.get.description, /\*\*api-vin — Voice IN Rates\*\*\n\nAudience api-vin/);
    assert.match(item.get.description, /\*\*api-vout — Voice OUT Rates\*\*\n\nAudience api-vout/);
    assert.equal(item.get.responses[404].description, 'no price');
  });

  it('labels differing response descriptions per service', () => {
    const sources = family();
    lookup(sources.voice_out).responses[200].description = 'the outbound prices';
    assert.equal(lookup(build(sources)).responses[200].description,
      '**api-vin — Voice IN Rates**\n\nthe prices\n\n**api-vout — Voice OUT Rates**\n\nthe outbound prices');
  });

  it('labels text only some sources carry', () => {
    const sources = family();
    delete lookup(sources.voice_out).description;
    assert.equal(lookup(build(sources)).description, '**api-vin — Voice IN Rates**\n\nAudience api-vin.didww.com.');
  });

  it('folds the path-level summary and description', () => {
    const sources = family();
    for (const name of ['voice_in', 'voice_out']) {
      sources[name].paths['/lookup/prices'].summary = 'Number lookup';
      sources[name].paths['/lookup/prices'].description = `Served by ${name}.`;
    }
    const folded = build(sources).paths['/lookup/prices'];
    assert.equal(folded.summary, 'Number lookup');
    assert.equal(folded.description,
      '**api-vin — Voice IN Rates**\n\nServed by voice_in.\n\n**api-vout — Voice OUT Rates**\n\nServed by voice_out.');
  });

  it('folds the differing response schemas into a oneOf and keeps identical ones', () => {
    assert.deepEqual(item.get.responses[200].content['application/vnd.api+json'].schema, {
      oneOf: [{ $ref: '#/components/schemas/VoiceInPriceCollectionDocument' }, { $ref: '#/components/schemas/VoiceOutPriceCollectionDocument' }],
    });
    assert.deepEqual(item.get.responses[404].content['application/vnd.api+json'].schema, error);
  });

  it('marks a parameter only one source accepts, after its own description', () => {
    const sources = family();
    lookup(sources.voice_in).parameters[1].description = 'Country of the caller.';
    const folded = lookup(build(sources));
    assert.equal(folded.parameters.find((p) => p.name === 'filter[src_country_iso]').description, 'Country of the caller.\n\nAccepted by: `api-vin`.');
    assert.equal(folded.parameters.find((p) => p.name === 'filter[number]').required, true);
  });

  it('marks a response only one source returns, whichever it is', () => {
    const sources = family();
    lookup(sources.voice_in).responses[400] = { description: 'bad filter' };
    lookup(sources.voice_out).responses[503] = { description: 'down' };
    const folded = lookup(build(sources));
    assert.equal(folded.responses[400].description, 'bad filter\n\nReturned by: `api-vin`.');
    assert.equal(folded.responses[503].description, 'down\n\nReturned by: `api-vout`.');
  });

  it('folds every method the sources share', () => {
    const sources = family();
    for (const name of ['voice_in', 'voice_out']) {
      sources[name].paths['/lookup/prices'].head = { ...lookup(sources[name]), operationId: 'checkLookupPrices' };
    }
    const folded = build(sources).paths['/lookup/prices'];
    assert.equal(folded.get.operationId, 'lookupPrices');
    assert.equal(folded.head.operationId, 'checkLookupPrices');
  });

  it('keeps identical examples and drops differing ones', () => {
    const sources = family();
    lookup(sources.voice_in).parameters[0].example = '18005550100';
    lookup(sources.voice_out).parameters[0].example = '441234567890';
    for (const name of ['voice_in', 'voice_out']) {
      lookup(sources[name]).responses[200].content['application/vnd.api+json'].example = { data: [{ id: '1' }] };
      lookup(sources[name]).responses[404].content['application/vnd.api+json'].example = { errors: [{ code: 'price_not_found' }] };
    }
    const folded = lookup(build(sources));
    assert.equal(folded.parameters[0].example, undefined);
    assert.deepEqual(folded.responses[200].content['application/vnd.api+json'].example, { data: [{ id: '1' }] });
    assert.deepEqual(folded.responses[404].content['application/vnd.api+json'].example, { errors: [{ code: 'price_not_found' }] });
    lookup(sources.voice_out).parameters[0].example = '18005550100';
    assert.equal(lookup(build(sources)).parameters[0].example, '18005550100');
  });

  it('keeps one tag and one operationId', () => {
    assert.deepEqual(doc.tags.map((t) => t.name), ['Account', 'Prices']);
    assert.equal(item.get.operationId, 'lookupPrices');
  });

  it('writes the enforced security on the folded operation when the main source enforces something else', () => {
    const folded = lookup(build({ api: apiKeyMain(), voice_in: voiceIn(), voice_out: voiceOut() }));
    assert.deepEqual(folded.security, [{ bearer_token: [] }]);
  });

  it('adds no operation-level security when the sources enforce what the main source does', () => {
    assert.equal(item.get.security, undefined);
  });

  it('inlines a chain of parameter $refs and drops every link of it from components', () => {
    const sources = family();
    for (const name of ['voice_in', 'voice_out']) {
      const base = { ...lookup(sources[name]).parameters[0] };
      delete base.description;
      sources[name].components.parameters = { NumberFilter: { $ref: '#/components/parameters/NumberFilterBase' }, NumberFilterBase: base };
      lookup(sources[name]).parameters[0] = { $ref: '#/components/parameters/NumberFilter' };
    }
    const folded = build(sources);
    assert.deepEqual(lookup(folded).parameters[0],
      { name: 'filter[number]', in: 'query', required: true, schema: { type: 'string', pattern: '^[1-9][0-9]{7,14}$' } });
    assert.equal(folded.components.parameters, undefined);
  });
});

describe('the disjointness proof of a folded oneOf', () => {
  // Two sources whose resources differ only in the schema of the one attribute both require.
  const twins = (vin, vout) => {
    const sources = {
      api: mainSource(),
      voice_in: serviceSource('api-vin', 'Voice IN Rates', 'VoiceInPrice', ['destination']),
      voice_out: serviceSource('api-vout', 'Voice OUT Rates', 'VoiceOutPrice', ['destination']),
    };
    Object.assign(resourceOf(sources.voice_in).properties.attributes.properties.destination, vin);
    Object.assign(resourceOf(sources.voice_out).properties.attributes.properties.destination, vout);
    return sources;
  };
  const branches = (sources) => lookup(build(sources)).responses[200].content['application/vnd.api+json'].schema.oneOf;
  const unprovable = /not provably disjoint/;

  it('holds for resources that each require an attribute the other does not declare', () => {
    assert.equal(branches(family()).length, 2);
  });

  it('holds for single-value enums at an attribute both require', () => {
    assert.equal(branches(twins({ enum: ['a'] }, { enum: ['b'] })).length, 2);
  });

  it('holds when only one side accepts null', () => {
    assert.equal(branches(twins({ enum: ['a'] }, { enum: ['b'], nullable: true })).length, 2);
  });

  it('holds for an enum without a type facing a nullable enum', () => {
    assert.equal(branches(twins({ type: undefined, enum: ['a'] }, { enum: ['b'], nullable: true })).length, 2);
  });

  // api-vout also requires `kind`, which api-vin only declares, so one pair order alone reaches it.
  const oneSided = (vinKind, voutKind) => {
    const sources = twins({}, {});
    const vin = resourceOf(sources.voice_in).properties.attributes;
    const vout = resourceOf(sources.voice_out).properties.attributes;
    vin.properties.kind = { type: 'string', ...vinKind };
    vout.properties.kind = { type: 'string', ...voutKind };
    vout.properties.network = { type: 'string' };
    vout.required.push('kind', 'network');
    return sources;
  };

  it('holds through an attribute only one side requires', () => {
    assert.equal(branches(oneSided({ enum: ['x'] }, { enum: ['y'] })).length, 2);
  });

  it('holds for an attribute named like a member every object inherits', () => {
    const sources = family();
    sources.voice_in = serviceSource('api-vin', 'Voice IN Rates', 'VoiceInPrice', ['constructor']);
    assert.equal(branches(sources).length, 2);
  });

  it('fails for resources whose required attributes the other declares too', () => {
    const sources = twins({}, {});
    resourceOf(sources.voice_in).properties.attributes.properties.extra = { type: 'string' };
    rejects(sources, unprovable);
  });

  it('fails for overlapping enums, compared by value', () => {
    rejects(twins({ enum: ['a', 'b'] }, { enum: ['b', 'c'] }), unprovable);
    rejects(twins({ type: 'object', enum: [{ code: 'a' }] }, { type: 'object', enum: [{ code: 'a' }] }), unprovable);
  });

  it('fails for an enum without a type that lists null, facing a nullable enum', () => {
    rejects(twins({ type: undefined, enum: ['a', null] }, { enum: ['b'], nullable: true }), unprovable);
  });

  it('fails for enums at an attribute neither side requires', () => {
    const sources = twins({}, {});
    for (const [name, kind] of [['voice_in', 'x'], ['voice_out', 'y']]) {
      resourceOf(sources[name]).properties.attributes.properties.kind = { type: 'string', enum: [kind] };
    }
    rejects(sources, unprovable);
  });

  it('fails for enums that both accept null', () => {
    rejects(twins({ enum: ['a'], nullable: true }, { enum: ['b'], nullable: true }), unprovable);
  });

  it('fails for attributes objects that may both be null', () => {
    const sources = family();
    for (const name of ['voice_in', 'voice_out']) resourceOf(sources[name]).properties.attributes.nullable = true;
    rejects(sources, unprovable);
  });

  it('fails for a node without a type facing one that accepts null', () => {
    const sources = family();
    resourceOf(sources.voice_in).properties.attributes.nullable = true;
    delete resourceOf(sources.voice_out).properties.attributes.type;
    rejects(sources, unprovable);
  });

  it('fails for a collection that may be empty', () => {
    const sources = family();
    delete collectionOf(sources.voice_in).properties.data.minItems;
    rejects(sources, /oneOf branches 1 and 0 are not provably disjoint/);
  });

  it('fails for an object that may carry undeclared members', () => {
    const open = family();
    resourceOf(open.voice_out).properties.attributes.additionalProperties = { type: 'string' };
    rejects(open, unprovable);
    const bare = family();
    delete resourceOf(bare.voice_out).properties.attributes.properties;
    rejects(bare, unprovable);
  });

  it('fails for required members on nodes that are not objects', () => {
    rejects(twins({ required: ['code'], properties: {} }, { required: ['name'], properties: {} }), unprovable);
  });

  it('fails for items on nodes that are not arrays', () => {
    const items = (value) => ({ minItems: 1, items: { type: 'string', enum: [value] } });
    rejects(twins(items('a'), items('b')), unprovable);
  });

  it('fails for composed schemas, on either side', () => {
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      const sources = family();
      resourceOf(sources.voice_out)[keyword] = [{ type: 'object' }];
      rejects(sources, unprovable);
    }
    const negated = family();
    resourceOf(negated.voice_out).not = { type: 'string' };
    rejects(negated, unprovable);
    rejects(oneSided({ enum: ['x'], allOf: [{}] }, { enum: ['y'] }), unprovable);
    rejects(oneSided({ enum: ['x'] }, { enum: ['y'], allOf: [{}] }), unprovable);
  });

  it('fails, rather than recursing forever, for a required member that refers to itself', () => {
    const sources = twins({}, {});
    for (const name of ['voice_in', 'voice_out']) {
      sources[name].components.schemas.Chain = { type: 'object', required: ['next'], properties: { next: { $ref: '#/components/schemas/Chain' } } };
      const attributes = resourceOf(sources[name]).properties.attributes;
      attributes.properties.chain = { $ref: '#/components/schemas/Chain' };
      attributes.required.push('chain');
    }
    rejects(sources, unprovable);
  });

  it('fails for a $ref with sibling keys', () => {
    const sources = family();
    for (const name of ['voice_in', 'voice_out']) collectionOf(sources[name]).properties.data.items.nullable = true;
    rejects(sources, unprovable);
  });

  it('fails for a $ref that does not name a schema component, or names one that loops', () => {
    const nested = family();
    nested.voice_out.components.schemas.Wrapper = { type: 'object', properties: { VoiceOutPrice: { type: 'object' } } };
    collectionOf(nested.voice_out).properties.data.items = { $ref: '#/components/schemas/Wrapper/properties/VoiceOutPrice' };
    rejects(nested, unprovable);
    const loop = family();
    loop.voice_out.components.schemas.Loop = { $ref: '#/components/schemas/Loop' };
    collectionOf(loop.voice_out).properties.data.items = { $ref: '#/components/schemas/Loop' };
    rejects(loop, unprovable);
  });

  it('prints both branches', () => {
    rejects(twins({ enum: ['a', 'b'] }, { enum: ['b', 'c'] }),
      /\n {2}branch 0: \{"\$ref":"#\/components\/schemas\/VoiceInPriceCollectionDocument"\}\n {2}branch 1: \{"\$ref":"#\/components\/schemas\/VoiceOutPriceCollectionDocument"\}/);
  });
});

describe('components and tags', () => {
  it('keeps every components section of every source', () => {
    const vin = voiceIn();
    vin.components.examples = { Price: { value: { rate: '0.1' } } };
    lookup(vin).responses[200].content['application/vnd.api+json'].examples = { price: { $ref: '#/components/examples/Price' } };
    const doc = build({ api: mainSource(), voice_in: vin });
    assert.deepEqual(doc.components.examples, { Price: { value: { rate: '0.1' } } });
  });

  it('keeps a parameter component another kept one references', () => {
    const vin = voiceIn();
    vin.components.parameters = { A: { $ref: '#/components/parameters/B' }, B: lookup(vin).parameters[0] };
    lookup(vin).parameters[0] = { $ref: '#/components/parameters/A' };
    const doc = build({ api: mainSource(), voice_in: vin });
    assert.deepEqual(Object.keys(doc.components.parameters).sort(), ['A', 'B']);
  });

  it('keeps parameter components of the main source nothing references', () => {
    const main = mainSource();
    main.components.parameters = { Unused: { name: 'x', in: 'query', schema: { type: 'string' } } };
    assert.ok(build({ api: main }).components.parameters.Unused);
  });

  it('publishes no tags when no source declares any', () => {
    const main = mainSource();
    delete main.tags;
    delete main.paths['/balance'].get.tags;
    assert.equal(build({ api: main }).tags, undefined);
  });

  it('publishes service tags when the main source declares none', () => {
    const main = mainSource();
    delete main.tags;
    delete main.paths['/balance'].get.tags;
    assert.deepEqual(build({ api: main, voice_in: voiceIn() }).tags.map((t) => t.name), ['Prices']);
  });
});

describe('the build refuses', () => {
  it('a version that disagrees with VERSION', () => {
    const vin = voiceIn();
    vin.info.version = '2026-04-16';
    rejects({ api: mainSource(), voice_in: vin }, /info\.version is 2026-04-16, VERSION is 2026-10-01/);
  });

  it('a version name repeated outside info.version', () => {
    const vin = voiceIn();
    vin.info.description = `Version ${VERSION}.`;
    rejects({ api: mainSource(), voice_in: vin }, /appears outside info\.version/);
  });

  it('an OpenAPI version other than 3.0.3, and a missing info.version', () => {
    const vin = voiceIn();
    vin.openapi = '3.1.0';
    rejects({ api: mainSource(), voice_in: vin }, /openapi is "3\.1\.0", expected "3\.0\.3"/);
    const main = mainSource();
    delete main.info.version;
    rejects({ api: main }, /source api: info\.version is missing/);
  });

  it('a vendor extension', () => {
    const vin = voiceIn();
    lookup(vin)['x-internal'] = true;
    rejects({ api: mainSource(), voice_in: vin }, /vendor extension x-internal/);
    const vout = voiceOut();
    vout.components.schemas.Error['x-codegen'] = { name: 'Failure' };
    rejects({ api: mainSource(), voice_out: vout }, /vendor extension x-codegen at components\.schemas\.Error/);
    const listed = voiceIn();
    lookup(listed).parameters[0]['x-order'] = 1;
    rejects({ api: mainSource(), voice_in: listed }, /vendor extension x-order at paths\.\/lookup\/prices\.get\.parameters\.0/);
  });

  it('an external $ref', () => {
    const vin = voiceIn();
    lookup(vin).responses[404].content['application/vnd.api+json'].schema = { $ref: 'https://example.com/e.json' };
    rejects({ api: mainSource(), voice_in: vin }, /external \$ref/);
  });

  it('a missing or empty root security, or one naming an undefined scheme', () => {
    const vin = voiceIn();
    vin.security = [];
    rejects({ api: mainSource(), voice_in: vin }, /root security is missing or empty/);
    const vout = voiceOut();
    vout.security = [{ api_key: [] }];
    rejects({ api: mainSource(), voice_out: vout }, /names api_key/);
    const inherited = voiceOut();
    inherited.security = [{ constructor: [] }];
    rejects({ api: mainSource(), voice_out: inherited }, /names constructor/);
  });

  it('root servers of a service source other than its Production and Sandbox host', () => {
    const swapped = voiceIn();
    swapped.servers.reverse();
    rejects({ api: mainSource(), voice_in: swapped }, /root servers must be exactly Production https:\/\/api-vin\.didww\.com\/v3/);
    const third = voiceIn();
    third.servers.push({ url: 'https://api-vin.example.com/v3' });
    rejects({ api: mainSource(), voice_in: third }, /root servers must be exactly/);
    const otherService = serviceSource('api-vin', 'Voice OUT Rates', 'VoiceOutPrice', ['prefix']);
    rejects({ api: mainSource(), voice_out: otherService }, /source voice_out: root servers must be exactly Production https:\/\/api-vout\.didww\.com\/v3/);
    const relabelled = voiceIn();
    [relabelled.servers[0].description, relabelled.servers[1].description] = ['Sandbox', 'Production'];
    rejects({ api: mainSource(), voice_in: relabelled }, /described "Production" and "Sandbox"/);
    const unlabelled = voiceIn();
    for (const server of unlabelled.servers) delete server.description;
    rejects({ api: mainSource(), voice_in: unlabelled }, /described "Production" and "Sandbox"/);
  });

  it('a shared component that differs', () => {
    const sources = family();
    sources.voice_out.components.schemas.Error.properties.code.description = 'different';
    rejects(sources, /components\.schemas\.Error: source voice_out differs from source api/);
  });

  it('a shared operation field that differs', () => {
    const summary = family();
    lookup(summary.voice_out).summary = 'Price lookup';
    rejects(summary, /summary of source voice_out differs/);
    const docs = family();
    lookup(docs.voice_out).externalDocs = { url: 'https://doc.didww.com' };
    rejects(docs, /externalDocs of source voice_out differs/);
    const body = family();
    lookup(body.voice_out).requestBody = { content: { 'application/json': { schema: { type: 'object' } } } };
    rejects(body, /requestBody of source voice_out differs/);
  });

  it('a difference, printing both definitions', () => {
    const sources = family();
    lookup(sources.voice_out).summary = 'Price lookup';
    rejects(sources, /\n {2}voice_in: "Look up the price of a number"\n {2}voice_out: "Price lookup"$/);
  });

  it('two sources that enforce different security on a folded operation', () => {
    const sources = family();
    sources.voice_out.components.securitySchemes.other = { type: 'http', scheme: 'basic' };
    sources.voice_out.security = [{ other: [] }];
    rejects(sources, /source voice_out enforces security that differs/);
    const operation = family();
    lookup(operation.voice_out).security = [{}];
    rejects(operation, /source voice_out enforces security that differs/);
  });

  it('servers on an operation of a service source, folded or not', () => {
    const folded = family();
    lookup(folded.voice_in).servers = [{ url: 'https://api-vin.didww.com/v3' }];
    rejects(folded, /source voice_in: GET \/lookup\/prices declares its own servers/);
    const alone = voiceIn();
    lookup(alone).servers = [{ url: 'https://api-vout.didww.com/v3' }];
    rejects({ api: mainSource(), voice_in: alone }, /source voice_in: GET \/lookup\/prices declares its own servers/);
    const second = voiceIn();
    second.paths['/lookup/prices'].head = { ...lookup(second), operationId: 'checkLookupPrices', servers: [{ url: 'https://api-vout.didww.com/v3' }] };
    rejects({ api: mainSource(), voice_in: second }, /source voice_in: HEAD \/lookup\/prices declares its own servers/);
  });

  it('servers on a path item of a service source', () => {
    const vin = voiceIn();
    vin.paths['/lookup/prices'].servers = [{ url: 'https://example.com/v3' }];
    rejects({ api: mainSource(), voice_in: vin }, /source voice_in: path \/lookup\/prices declares its own servers/);
  });

  it('a path-level summary that differs on a folded path', () => {
    const sources = family();
    sources.voice_in.paths['/lookup/prices'].summary = 'Number lookup';
    sources.voice_out.paths['/lookup/prices'].summary = 'Price lookup';
    rejects(sources, /path \/lookup\/prices: summary of source voice_out differs from source voice_in/);
    const oneSided = family();
    oneSided.voice_in.paths['/lookup/prices'].summary = 'Number lookup';
    rejects(oneSided, /path \/lookup\/prices: summary of source voice_out differs from source voice_in/);
  });

  it('path-level fields other than summary and description on a folded path', () => {
    const sources = family();
    sources.voice_in.paths['/lookup/prices'].parameters = [{ name: 'x', in: 'query', schema: { type: 'string' } }];
    rejects(sources, /declares path-level parameters/);
    const referenced = family();
    referenced.voice_in.paths['/lookup/prices'].$ref = '#/paths/~1other';
    rejects(referenced, /declares path-level \$ref/);
  });

  it('sources that declare different methods on a folded path', () => {
    const sources = family();
    sources.voice_in.paths['/lookup/prices'].head = { ...lookup(sources.voice_in), operationId: 'headLookup' };
    rejects(sources, /the sources declare different methods \(voice_in: get, head; voice_out: get\)/);
  });

  it('a shared parameter whose schema or required differs', () => {
    const schema = family();
    lookup(schema.voice_out).parameters[0].schema = { type: 'string' };
    rejects(schema, /parameter query:filter\[number\]: source voice_out differs from voice_in/);
    const required = family();
    lookup(required.voice_out).parameters[0].required = false;
    rejects(required, /parameter query:filter\[number\]: source voice_out differs from voice_in/);
  });

  it('a header two sources spell differently', () => {
    const sources = family();
    lookup(sources.voice_in).parameters.push({ name: 'If-Modified-Since', in: 'header', required: false, schema: { type: 'string' } });
    lookup(sources.voice_out).parameters.push({ name: 'if-modified-since', in: 'header', required: false, schema: { type: 'string' } });
    rejects(sources, /parameter header:if-modified-since: source voice_out differs from voice_in/);
  });

  it('a parameter $ref that points elsewhere, resolves to nothing, or loops', () => {
    const elsewhere = family();
    lookup(elsewhere.voice_in).parameters[0] = { $ref: '#/components/schemas/Error' };
    rejects(elsewhere, /parameter \$ref #\/components\/schemas\/Error does not point at components\.parameters/);
    const missing = family();
    lookup(missing.voice_in).parameters[0] = { $ref: '#/components/parameters/Missing' };
    rejects(missing, /resolves to nothing/);
    const inherited = family();
    lookup(inherited.voice_in).parameters[0] = { $ref: '#/components/parameters/constructor' };
    rejects(inherited, /parameter \$ref #\/components\/parameters\/constructor resolves to nothing/);
    const loop = family();
    loop.voice_in.components.parameters = { A: { $ref: '#/components/parameters/A' } };
    lookup(loop.voice_in).parameters[0] = { $ref: '#/components/parameters/A' };
    rejects(loop, /parameter \$ref #\/components\/parameters\/A is circular/);
  });

  it('a parameter one source declares twice on a folded operation', () => {
    const sources = family();
    lookup(sources.voice_in).parameters.push({ ...lookup(sources.voice_in).parameters[1] });
    rejects(sources, /source voice_in declares parameter query:filter\[src_country_iso\] twice/);
  });

  it('a required parameter only some sources declare', () => {
    const sources = family();
    lookup(sources.voice_in).parameters[1].required = true;
    rejects(sources, /required, but only some sources declare it/);
  });

  it('responses that differ in headers, media types or outside the schema', () => {
    const media = family();
    lookup(media.voice_out).responses[404].content['application/json'] = { schema: error };
    rejects(media, /response 404: source voice_out differs from voice_in in headers or media types/);
    const headers = family();
    lookup(headers.voice_out).responses[404].headers = { 'Retry-After': { schema: { type: 'integer' } } };
    rejects(headers, /response 404: source voice_out differs from voice_in in headers or media types/);
    const encoding = family();
    lookup(encoding.voice_out).responses[404].content['application/vnd.api+json'].encoding = { a: {} };
    rejects(encoding, /response 404 application\/vnd\.api\+json: source voice_out differs from voice_in outside the schema/);
  });

  it('a $ref response only some sources declare', () => {
    const sources = family();
    sources.voice_in.components.responses = { Unavailable: { description: 'down' } };
    lookup(sources.voice_in).responses[503] = { $ref: '#/components/responses/Unavailable' };
    rejects(sources, /response 503: only `api-vin` declare it, as a \$ref/);
  });

  it('a path served by the main source and a service source', () => {
    const main = mainSource();
    main.paths['/lookup/prices'] = voiceIn().paths['/lookup/prices'];
    rejects({ api: main, voice_in: voiceIn() }, /served by api and by voice_in/);
  });

  it('an operationId on two different paths', () => {
    const vin = voiceIn();
    lookup(vin).operationId = 'getBalance';
    rejects({ api: mainSource(), voice_in: vin }, /operationId getBalance is used on/);
  });

  it('a tag declared differently by two sources', () => {
    const sources = family();
    sources.voice_out.tags[0].description = 'other';
    rejects(sources, /tag Prices: source voice_out declares it differently from source voice_in\n {2}voice_in: .*\n {2}voice_out: /);
  });

  it('an unknown source and a missing main source', () => {
    rejects({ api: mainSource(), voice_x: voiceIn() }, /unknown source voice_x/);
    rejects({ voice_in: voiceIn() }, /the api source is missing/);
  });
});
