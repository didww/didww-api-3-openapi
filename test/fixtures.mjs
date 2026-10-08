// Minimal sources shaped like the ones the services generate.
export const VERSION = '2026-10-01';

export const error = { $ref: '#/components/schemas/ErrorsDocument' };
const errorsComponents = {
  Error: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } },
  ErrorsDocument: { type: 'object', required: ['errors'], properties: { errors: { type: 'array', items: { $ref: '#/components/schemas/Error' } } } },
};
const bearer = { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' };

export const mainSource = () => ({
  openapi: '3.0.3',
  info: { title: 'DIDWW Public API', version: VERSION },
  tags: [{ name: 'Account', description: 'Balance.' }],
  servers: [{ url: 'https://api.didww.com/v3', description: 'Production' }, { url: 'https://sandbox-api.didww.com/v3', description: 'Sandbox' }],
  components: { securitySchemes: { bearer_token: bearer }, schemas: structuredClone(errorsComponents) },
  security: [{ bearer_token: [] }],
  paths: {
    '/balance': { get: { tags: ['Account'], operationId: 'getBalance', summary: 'Balance', description: 'The balance.', responses: { 200: { description: 'ok' } } } },
  },
});

const priceSchema = (name, attributes) => ({
  [name]: {
    type: 'object',
    required: ['id', 'type', 'attributes'],
    properties: {
      id: { type: 'string' },
      type: { type: 'string', enum: ['prices'] },
      attributes: { type: 'object', required: attributes, properties: Object.fromEntries(attributes.map((a) => [a, { type: 'string' }])) },
    },
  },
  [`${name}CollectionDocument`]: {
    type: 'object',
    required: ['data'],
    // An empty lookup answer is a 404, never an empty collection.
    properties: { data: { type: 'array', minItems: 1, items: { $ref: `#/components/schemas/${name}` } } },
  },
});

export const serviceSource = (service, title, schema, attributes, extraParameters = []) => ({
  openapi: '3.0.3',
  info: { title, version: VERSION },
  tags: [{ name: 'Prices', description: 'Price files and lookups.' }],
  servers: [{ url: `https://${service}.didww.com/v3`, description: 'Production' }, { url: `https://${service}-sandbox.didww.com/v3`, description: 'Sandbox' }],
  components: {
    securitySchemes: { bearer_token: bearer },
    schemas: { ...structuredClone(errorsComponents), ...priceSchema(schema, attributes) },
  },
  security: [{ bearer_token: [] }],
  paths: {
    '/lookup/prices': {
      get: {
        tags: ['Prices'],
        operationId: 'lookupPrices',
        summary: 'Look up the price of a number',
        description: `Audience ${service}.didww.com.`,
        parameters: [
          { name: 'filter[number]', in: 'query', required: true, description: `Number priced by ${service}.`, schema: { type: 'string', pattern: '^[1-9][0-9]{7,14}$' } },
          ...extraParameters,
        ],
        responses: {
          200: { description: 'the prices', content: { 'application/vnd.api+json': { schema: { $ref: `#/components/schemas/${schema}CollectionDocument` } } } },
          404: { description: 'no price', content: { 'application/vnd.api+json': { schema: error } } },
        },
      },
    },
  },
});

export const voiceIn = () => serviceSource('api-vin', 'Voice IN Rates', 'VoiceInPrice', ['destination', 'source_type'],
  [{ name: 'filter[src_country_iso]', in: 'query', required: false, schema: { type: 'string' } }]);
export const voiceOut = () => serviceSource('api-vout', 'Voice OUT Rates', 'VoiceOutPrice', ['prefix', 'network']);

