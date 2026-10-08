// Builds the published document, openapi/v3_api.json and .yaml, from the
// per-service sources in openapi/sources/. Nothing in the output is written by
// hand: every path comes from the source of the service that serves it.
//
//   node scripts/build.mjs            # writes openapi/v3_api.json and .yaml
//   node scripts/build.mjs --out DIR  # writes DIR/v3_api.json and .yaml
//
// A source that breaks a rule below fails the build with a message naming the
// source and the place; the build never repairs a source.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

// Load order: the main source, api.json (api.didww.com), first, then the
// service sources in a fixed order, so the folded server variable and
// descriptions never depend on the file system. Each service source serves
// exactly one host.
export const SOURCE_ORDER = ['api', 'voice_in', 'voice_out', 'sms'];
export const SERVICE_OF = { voice_in: 'api-vin', voice_out: 'api-vout', sms: 'api-sms' };
const MAIN = 'api';
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
// Folded separately: the text is kept per service, the security is compared as
// what each source enforces.
const FOLDED_OPERATION_KEYS = ['description', 'parameters', 'responses', 'security'];

export class BuildError extends Error {}

const fail = (message) => {
  throw new BuildError(message);
};

// Key order carries no meaning, so documents are compared with their keys sorted.
export const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const clone = (value) => structuredClone(value);
const without = (object, ...keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
const refsIn = (value, prefix) => new Set(JSON.stringify(value).match(new RegExp(`${prefix}[^"]+`, 'g')) ?? []);

const walk = (node, visit, path = []) => {
  visit(node, path);
  if (Array.isArray(node)) node.forEach((item, index) => walk(item, visit, [...path, index]));
  else if (node !== null && typeof node === 'object') Object.entries(node).forEach(([key, item]) => walk(item, visit, [...path, key]));
};

// What every source has to be on its own.
const checkSource = (name, doc) => {
  const where = `source ${name}`;
  if (doc.openapi !== '3.0.3') fail(`${where}: openapi is ${JSON.stringify(doc.openapi)}, expected "3.0.3"`);
  if (!doc.info?.version) fail(`${where}: info.version is missing`);

  walk(doc, (node, path) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      if (key.startsWith('x-')) fail(`${where}: vendor extension ${key} at ${path.join('.') || '(root)'}`);
    }
    if (typeof node.$ref === 'string' && !node.$ref.startsWith('#/')) {
      fail(`${where}: external $ref ${node.$ref} at ${path.join('.')}`);
    }
  });

  const security = doc.security;
  if (!Array.isArray(security) || security.length === 0) fail(`${where}: root security is missing or empty`);
  const schemes = doc.components?.securitySchemes ?? {};
  for (const requirement of security) {
    for (const scheme of Object.keys(requirement)) {
      if (!Object.hasOwn(schemes, scheme)) fail(`${where}: root security names ${scheme}, which components.securitySchemes does not define`);
    }
  }

  if (name === MAIN) return { name, doc };

  const service = SERVICE_OF[name];
  const expected = [
    { url: `https://${service}.didww.com/v3`, description: 'Production' },
    { url: `https://${service}-sandbox.didww.com/v3`, description: 'Sandbox' },
  ];
  if (!same(doc.servers, expected)) {
    fail(`${where}: root servers must be exactly Production ${expected[0].url} and Sandbox ${expected[1].url}, ` +
         `described "Production" and "Sandbox", got ${JSON.stringify(doc.servers ?? null)}`);
  }
  // Its hosts are its root servers: a server on a path or an operation would
  // send that operation to another host.
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    const places = [[`path ${path}`, item], ...operationsOf(item).map((method) => [`${method.toUpperCase()} ${path}`, item[method]])];
    for (const [place, node] of places) {
      if (node.servers) fail(`${where}: ${place} declares its own servers; a service source names its hosts only in its root servers`);
    }
  }

  const rest = JSON.stringify({ ...doc, info: without(doc.info, 'version') });
  if (rest.includes(doc.info.version)) fail(`${where}: the version name ${doc.info.version} appears outside info.version`);

  return { name, doc, service, title: doc.info.title };
};

const PARAMETER_REF = /^#\/components\/parameters\/([^/]+)$/;

const resolveParameter = (source, parameter, seen = new Set()) => {
  if (!parameter.$ref) return parameter;
  const match = parameter.$ref.match(PARAMETER_REF);
  if (!match) fail(`source ${source.name}: parameter $ref ${parameter.$ref} does not point at components.parameters`);
  if (seen.has(match[1])) fail(`source ${source.name}: parameter $ref ${parameter.$ref} is circular`);
  const declared = source.doc.components?.parameters ?? {};
  const resolved = Object.hasOwn(declared, match[1]) ? declared[match[1]] : undefined;
  if (!resolved) fail(`source ${source.name}: parameter $ref ${parameter.$ref} resolves to nothing`);
  return resolveParameter(source, resolved, new Set([...seen, match[1]]));
};

// A difference the fold cannot union: the message names the place and prints
// both definitions.
const differs = (message, leftName, left, rightName, right) => fail(
  `${message}\n  ${leftName}: ${JSON.stringify(canonical(left) ?? null)}\n  ${rightName}: ${JSON.stringify(canonical(right) ?? null)}`,
);

// Examples illustrate one service and cannot be labelled: identical ones are
// kept, differing ones are dropped.
const EXAMPLE_KEYS = ['example', 'examples'];
const sharedExamples = (values) => Object.fromEntries(EXAMPLE_KEYS
  .filter((key) => values[0][key] !== undefined && values.every((value) => same(value[key], values[0][key])))
  .map((key) => [key, clone(values[0][key])]));

const label = (source) => `**${source.service} — ${source.title}**`;
const servicesOf = (declared) => declared.map(([source]) => `\`${source.service}\``).join(', ');

// Prose is folded: identical text is kept once, differing text is kept per
// service under its label, in load order.
const foldText = (entries) => {
  const present = entries.filter(([, text]) => text !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === entries.length && present.every(([, text]) => text === present[0][1])) return present[0][1];
  return present.map(([source, text]) => `${label(source)}\n\n${text}`).join('\n\n');
};

const appendText = (text, addition) => (text === undefined ? addition : `${text}\n\n${addition}`);

// Disjointness of the branches of a folded oneOf. A response of a service
// carries only the members its schema declares — each service's suite
// validates every documented response with additional properties refused —
// so `excludes(a, b)` proves that no such response valid against `b` is valid
// against `a`. It walks only nodes that every `b`-instance contains (properties
// `b` requires of an object, items of an array `b` makes non-empty) and that
// `a` constrains, and looks for a property `a` requires there that `b` does not
// declare, or for enums the two pin to disjoint values.
//
// The proof is sound only for what it models, so everything else counts as
// unprovable and fails the build: a node composed with allOf/anyOf/oneOf/not,
// a `$ref` with sibling keys (rswag honours a `nullable` beside it) or other
// than #/components/schemas/<name>, two nodes that both accept null, a
// required member where neither node is an object, items where neither node
// is an array, and the "does not declare" argument on a `b` node whose
// instances may carry undeclared members.
const COMPOSITION = ['allOf', 'anyOf', 'oneOf', 'not'];
const SCHEMA_REF = /^#\/components\/schemas\/([^/]+)$/;
const own = (object, key) => (object && Object.hasOwn(object, key) ? object[key] : undefined);

const resolveSchema = (components, schema) => {
  let current = schema;
  const seen = new Set();
  while (current && current.$ref !== undefined) {
    const match = typeof current.$ref === 'string' && current.$ref.match(SCHEMA_REF);
    if (!match || seen.has(match[1]) || Object.keys(current).length > 1) return null;
    seen.add(match[1]);
    current = own(components.schemas, match[1]);
  }
  return current !== null && typeof current === 'object' && !Array.isArray(current) ? current : null;
};

// Whether null may be valid against a node: rswag, like some clients, accepts
// null on any nullable node whatever else it says, and a node without a type
// accepts it unless an enum leaves it out.
const admitsNull = (schema) => schema.nullable === true ||
  (typeof schema.type !== 'string' && !(Array.isArray(schema.enum) && !schema.enum.includes(null)));

// Whether an instance of a node carries only the members the node declares:
// the suites refuse undeclared members wherever `properties` is given, and
// `additionalProperties: false` refuses them anyway.
const closed = (schema) => schema.additionalProperties === false ||
  (schema.properties !== undefined && schema.additionalProperties === undefined);

const excludes = (components, a, b, depth = 0) => {
  if (depth > 32) return false;
  const left = resolveSchema(components, a);
  const right = resolveSchema(components, b);
  if (!left || !right) return false;
  if (COMPOSITION.some((key) => key in left || key in right)) return false;
  if (admitsNull(left) && admitsNull(right)) return false;

  if (Array.isArray(left.enum) && Array.isArray(right.enum) && !left.enum.some((value) => right.enum.some((other) => same(value, other)))) {
    return true;
  }
  if (left.type === 'object' || right.type === 'object') {
    if (closed(right) && (left.required ?? []).some((property) => own(right.properties, property) === undefined)) return true;
    for (const property of right.required ?? []) {
      const [mine, theirs] = [own(left.properties, property), own(right.properties, property)];
      if (mine && theirs && excludes(components, mine, theirs, depth + 1)) return true;
    }
  }
  if ((left.type === 'array' || right.type === 'array') && left.items && right.items && (right.minItems ?? 0) >= 1) {
    return excludes(components, left.items, right.items, depth + 1);
  }
  return false;
};

const foldResponse = (components, where, entries, total) => {
  const [[firstSource, first]] = entries;
  const shape = (value) => ({ ...without(value, 'description', 'content'), media: Object.keys(value.content ?? {}).sort() });
  for (const [source, response] of entries.slice(1)) {
    if (!same(shape(first), shape(response))) {
      differs(`${where}: source ${source.name} differs from ${firstSource.name} in headers or media types`,
        firstSource.name, shape(first), source.name, shape(response));
    }
  }

  const folded = without(first, 'description', 'content');
  if (first.$ref) {
    if (entries.length < total) {
      fail(`${where}: only ${servicesOf(entries)} declare it, as a $ref; a status only some services return must be written inline so it can say which`);
    }
    return folded;
  }
  let description = foldText(entries.map(([source, response]) => [source, response.description]));
  if (entries.length < total) description = appendText(description, `Returned by: ${servicesOf(entries)}.`);
  if (description !== undefined) folded.description = description;

  if (first.content) {
    folded.content = {};
    for (const media of Object.keys(first.content)) {
      const bodies = entries.map(([, response]) => response.content[media]);
      for (const [index, body] of bodies.entries()) {
        if (!same(without(body, 'schema', ...EXAMPLE_KEYS), without(bodies[0], 'schema', ...EXAMPLE_KEYS))) {
          differs(`${where} ${media}: source ${entries[index][0].name} differs from ${firstSource.name} outside the schema`,
            firstSource.name, without(bodies[0], 'schema', ...EXAMPLE_KEYS), entries[index][0].name, without(body, 'schema', ...EXAMPLE_KEYS));
        }
      }
      const schemas = bodies.map((body) => body.schema);
      const distinct = schemas.filter((schema, index) => schemas.findIndex((other) => same(other, schema)) === index);
      if (distinct.length === 1) {
        folded.content[media] = { ...without(bodies[0], 'schema', ...EXAMPLE_KEYS), schema: clone(distinct[0]), ...sharedExamples(bodies) };
        continue;
      }
      for (const [i, a] of distinct.entries()) {
        for (const [j, b] of distinct.entries()) {
          if (i !== j && !excludes(components, a, b)) {
            differs(`${where} ${media}: oneOf branches ${i} and ${j} are not provably disjoint — a response of branch ${j} could also ` +
                    `be valid against branch ${i}; each branch must require, at a node every response of the others contains, ` +
                    'a property the others do not declare (a collection must declare minItems: 1 for its items to count; ' +
                    'nodes that may be null, open objects and allOf/anyOf/oneOf/not cannot be used in the proof)',
            `branch ${i}`, a, `branch ${j}`, b);
          }
        }
      }
      folded.content[media] = { ...without(bodies[0], 'schema', ...EXAMPLE_KEYS), schema: { oneOf: distinct }, ...sharedExamples(bodies) };
    }
  }
  return folded;
};

const foldOperation = (components, where, entries, mainSecurity) => {
  const [[firstSource, first]] = entries;
  for (const [source, operation] of entries.slice(1)) {
    const left = without(first, ...FOLDED_OPERATION_KEYS);
    const right = without(operation, ...FOLDED_OPERATION_KEYS);
    const key = [...new Set([...Object.keys(left), ...Object.keys(right)])].find((name) => !same(left[name], right[name]));
    if (key) differs(`${where}: ${key} of source ${source.name} differs from source ${firstSource.name}`, firstSource.name, left[key], source.name, right[key]);
  }

  // What each source enforces: the operation's own security, else its root.
  const enforced = entries.map(([source, operation]) => operation.security ?? source.doc.security);
  for (const [index, security] of enforced.entries()) {
    if (!same(security, enforced[0])) {
      differs(`${where}: source ${entries[index][0].name} enforces security that differs from source ${firstSource.name}`,
        firstSource.name, enforced[0], entries[index][0].name, security);
    }
  }

  const folded = without(first, ...FOLDED_OPERATION_KEYS);
  if (!same(enforced[0], mainSecurity)) folded.security = clone(enforced[0]);
  const description = foldText(entries.map(([source, operation]) => [source, operation.description]));
  if (description !== undefined) folded.description = description;

  const parameters = new Map();
  for (const [source, operation] of entries) {
    for (const raw of operation.parameters ?? []) {
      const parameter = resolveParameter(source, raw);
      // Header names are case-insensitive: two spellings are one parameter.
      const key = `${parameter.in}:${parameter.in === 'header' ? parameter.name.toLowerCase() : parameter.name}`;
      if (!parameters.has(key)) parameters.set(key, []);
      if (parameters.get(key).some(([other]) => other === source)) fail(`${where}: source ${source.name} declares parameter ${key} twice`);
      parameters.get(key).push([source, parameter]);
    }
  }
  const parameterList = [...parameters.entries()].map(([key, declared]) => {
    const [[baseSource, base]] = declared;
    for (const [source, parameter] of declared.slice(1)) {
      if (!same(without(parameter, 'description', ...EXAMPLE_KEYS), without(base, 'description', ...EXAMPLE_KEYS))) {
        differs(`${where} parameter ${key}: source ${source.name} differs from ${baseSource.name}`,
          baseSource.name, without(base, 'description', ...EXAMPLE_KEYS), source.name, without(parameter, 'description', ...EXAMPLE_KEYS));
      }
    }
    const parameter = { ...without(base, 'description', ...EXAMPLE_KEYS), ...sharedExamples(declared.map(([, value]) => value)) };
    let text = foldText(declared.map(([source, value]) => [source, value.description]));
    if (declared.length < entries.length) {
      if (declared.some(([, value]) => value.required)) fail(`${where} parameter ${key}: required, but only some sources declare it`);
      text = appendText(text, `Accepted by: ${servicesOf(declared)}.`);
    }
    if (text !== undefined) parameter.description = text;
    return parameter;
  });
  if (parameterList.length > 0) folded.parameters = parameterList;

  const statuses = [...new Set(entries.flatMap(([, operation]) => Object.keys(operation.responses ?? {})))];
  folded.responses = {};
  for (const status of statuses) {
    const declared = entries.filter(([, operation]) => operation.responses?.[status]).map(([source, operation]) => [source, operation.responses[status]]);
    folded.responses[status] = foldResponse(components, `${where} response ${status}`, declared, entries.length);
  }
  return folded;
};

const pathServers = (sources) => {
  const enumeration = sources.map((source) => source.service);
  const description = sources.map((source) => `${source.service} — ${source.title}`).join('; ');
  const variables = { service: { enum: enumeration, default: enumeration[0], description } };
  return [
    { url: 'https://{service}.didww.com/v3', description: 'Production', variables: clone(variables) },
    { url: 'https://{service}-sandbox.didww.com/v3', description: 'Sandbox', variables: clone(variables) },
  ];
};

const operationsOf = (item) => HTTP_METHODS.filter((method) => item[method]);

// Components are a union of every section; a name in several sources
// must be canonically identical.
const mergeComponents = (sources) => {
  const components = {};
  const owners = {};
  for (const source of sources) {
    for (const [section, entries] of Object.entries(source.doc.components ?? {})) {
      components[section] ??= {};
      owners[section] ??= {};
      for (const [name, value] of Object.entries(entries)) {
        if (Object.hasOwn(components[section], name)) {
          if (!same(components[section][name], value)) {
            differs(`components.${section}.${name}: source ${source.name} differs from source ${owners[section][name]}`,
              owners[section][name], components[section][name], source.name, value);
          }
          continue;
        }
        components[section][name] = clone(value);
        owners[section][name] = source.name;
      }
    }
  }
  return { components, owners };
};

// Parameter components of service sources that only folded paths referenced
// are inlined there; the ones nothing references any more are dropped, until
// no reference — from the paths or from another component — is left dangling.
const dropUnreferencedParameters = (paths, components, owners) => {
  if (!components.parameters) return;
  const prefix = '#/components/parameters/';
  for (;;) {
    const referenced = refsIn({ paths, components }, prefix);
    const unused = Object.keys(components.parameters)
      .filter((name) => owners.parameters[name] !== MAIN && !referenced.has(`${prefix}${name}`));
    if (unused.length === 0) return;
    for (const name of unused) delete components.parameters[name];
  }
};

export const buildDocument = (rawSources, version) => {
  const names = Object.keys(rawSources);
  for (const name of names) if (!SOURCE_ORDER.includes(name)) fail(`unknown source ${name}; expected one of ${SOURCE_ORDER.join(', ')}`);
  if (!names.includes(MAIN)) fail(`the ${MAIN} source is missing`);
  const sources = SOURCE_ORDER.filter((name) => names.includes(name)).map((name) => checkSource(name, rawSources[name]));
  const main = sources[0].doc;

  for (const source of sources) {
    if (source.doc.info.version !== version) fail(`source ${source.name}: info.version is ${source.doc.info.version}, VERSION is ${version}`);
  }

  const { components, owners } = mergeComponents(sources);

  // Paths are copied when one source serves them and folded when several do.
  const byPath = new Map();
  for (const source of sources) {
    for (const [path, item] of Object.entries(source.doc.paths ?? {})) {
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push([source, item]);
    }
  }

  const paths = {};
  for (const [path, served] of byPath) {
    if (served.length === 1) {
      const [[source, item]] = served;
      const copy = clone(item);
      if (source.name !== MAIN) {
        copy.servers = clone(source.doc.servers);
        if (!same(source.doc.security, main.security)) {
          for (const method of operationsOf(copy)) copy[method].security ??= clone(source.doc.security);
        }
      }
      paths[path] = copy;
      continue;
    }

    if (served.some(([source]) => source.name === MAIN)) {
      fail(`path ${path}: served by ${MAIN} and by ${served.filter(([s]) => s.name !== MAIN).map(([s]) => s.name).join(', ')}; ` +
           `the main source's hosts do not fit the {service} server templates`);
    }
    const methods = served.map(([source, item]) => [source.name, operationsOf(item).join(', ')]);
    if (methods.some(([, list]) => list !== methods[0][1])) {
      fail(`path ${path}: the sources declare different methods (${methods.map(([name, list]) => `${name}: ${list}`).join('; ')})`);
    }
    for (const [source, item] of served) {
      const extra = Object.keys(item).filter((key) => !HTTP_METHODS.includes(key) && !['summary', 'description'].includes(key));
      if (extra.length > 0) fail(`path ${path}: source ${source.name} declares path-level ${extra.join(', ')}; a folded path takes operation-level fields only`);
    }

    const [[firstSource, firstItem]] = served;
    for (const [source, item] of served.slice(1)) {
      if (!same(item.summary, firstItem.summary)) {
        differs(`path ${path}: summary of source ${source.name} differs from source ${firstSource.name}`,
          firstSource.name, firstItem.summary, source.name, item.summary);
      }
    }
    const folded = { servers: pathServers(served.map(([source]) => source)) };
    if (firstItem.summary !== undefined) folded.summary = firstItem.summary;
    const description = foldText(served.map(([source, item]) => [source, item.description]));
    if (description !== undefined) folded.description = description;
    for (const method of operationsOf(served[0][1])) {
      folded[method] = foldOperation(components, `path ${path} ${method.toUpperCase()}`,
        served.map(([source, item]) => [source, item[method]]), main.security);
    }
    paths[path] = folded;
  }

  const operationIds = new Map();
  for (const [path, item] of Object.entries(paths)) {
    for (const method of operationsOf(item)) {
      const id = item[method].operationId;
      if (!id) continue;
      if (operationIds.has(id)) fail(`operationId ${id} is used on ${operationIds.get(id)} and on ${method.toUpperCase()} ${path}`);
      operationIds.set(id, `${method.toUpperCase()} ${path}`);
    }
  }

  dropUnreferencedParameters(paths, components, owners);

  // Tags are a union; a tag in several sources must carry the same description.
  const tags = [];
  const tagOwners = new Map();
  for (const source of sources) {
    for (const tag of source.doc.tags ?? []) {
      const existing = tags.find((other) => other.name === tag.name);
      if (!existing) {
        tags.push(clone(tag));
        tagOwners.set(tag.name, source.name);
      } else if (!same(existing, tag)) {
        differs(`tag ${tag.name}: source ${source.name} declares it differently from source ${tagOwners.get(tag.name)}`,
          tagOwners.get(tag.name), existing, source.name, tag);
      }
    }
  }

  const assembled = {
    paths,
    components: Object.fromEntries(Object.entries(components).filter(([, value]) => Object.keys(value).length > 0)),
    tags,
  };
  const result = {};
  for (const key of Object.keys(main)) result[key] = key in assembled ? assembled[key] : clone(main[key]);
  for (const [key, value] of Object.entries(assembled)) {
    const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
    if (!(key in result) && (key === 'paths' || !empty)) result[key] = value;
  }
  return result;
};

export const loadSources = (dir) => Object.fromEntries(
  readdirSync(dir).filter((file) => file.endsWith('.json')).sort()
    .map((file) => [file.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, file), 'utf8'))]),
);

export const serialize = (doc) => ({
  json: `${JSON.stringify(doc, null, 2)}\n`,
  yaml: yaml.dump(doc, { lineWidth: -1, noRefs: true }),
});

const main = (argv) => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const outIndex = argv.indexOf('--out');
  const out = outIndex === -1 ? join(root, 'openapi') : argv[outIndex + 1];
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
  const doc = buildDocument(loadSources(join(root, 'openapi', 'sources')), version);
  const { json, yaml: yamlText } = serialize(doc);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'v3_api.json'), json);
  writeFileSync(join(out, 'v3_api.yaml'), yamlText);
  console.log(`Built ${join(out, 'v3_api.json')} and v3_api.yaml from ${Object.keys(doc.paths).length} paths, version ${version}`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof BuildError)) throw error;
    console.error(`build: ${error.message}`);
    process.exit(1);
  }
}
