// Guards the invariants this repository can check on its own — everything else
// about the document is guaranteed by the suite that generates it.
//
//   - the JSON and the YAML file describe the same document. They are written by
//     the same release step, so a difference means one of them was updated by hand
//     or a release was interrupted halfway;
//   - VERSION names the API version the document actually describes.
//
// Takes the YAML file already converted to JSON (see the workflow) so the check
// itself needs no dependencies.
import { readFileSync } from 'node:fs';

const [, , yamlAsJsonPath] = process.argv;

if (!yamlAsJsonPath) {
  console.error('usage: check-document.mjs <yaml-converted-to-json>');
  process.exit(2);
}

const json = JSON.parse(readFileSync('openapi/v3_api.json', 'utf8'));
const yaml = JSON.parse(readFileSync(yamlAsJsonPath, 'utf8'));
const version = readFileSync('VERSION', 'utf8').trim();

// Key order carries no meaning in either format, so compare the documents with
// their keys sorted rather than as written.
const canonical = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

const failures = [];

if (JSON.stringify(canonical(json)) !== JSON.stringify(canonical(yaml))) {
  failures.push('openapi/v3_api.json and openapi/v3_api.yaml describe different documents');
}

if (json.info.version !== version) {
  failures.push(`VERSION says ${version}, but the document's info.version is ${json.info.version}`);
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`error: ${failure}`));
  process.exit(1);
}

console.log(`OK: both formats describe the DIDWW API v3, version ${version}`);
