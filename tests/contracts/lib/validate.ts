import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { openapiSchemaToJsonSchema } from '@openapi-contrib/openapi-schema-to-json-schema';
import { matchPathTemplate, stripQuery } from './paths';
import { loadContract, type Contract, type ServiceId } from './spec';

type Schema = Record<string, unknown>;

export interface OperationMatch {
  specPath: string;
  operation: Record<string, unknown>;
}

interface CompiledContract {
  ajv: Ajv2020;
  validators: Map<string, ValidateFunction>;
}

const compiled = new WeakMap<Contract, CompiledContract>();
const COMPONENT_REF = '#/components/schemas/';
const OPEN_COMPONENT_REF = '#/components/openSchemas/';

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The converter drops `nullable` on schemas without `type` (e.g. Swashbuckle's `{ allOf: [$ref], nullable }`).
function wrapTypelessNullable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(wrapTypelessNullable);
  }
  if (!isSchema(value)) {
    return value;
  }
  const mapped = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, wrapTypelessNullable(child)]));
  if (mapped.nullable !== true || 'type' in mapped) {
    return mapped;
  }
  const { nullable: _nullable, ...rest } = mapped;
  return { anyOf: [rest, { type: 'null' }] };
}

function toJsonSchema(contract: Contract, schema: unknown): Schema {
  if (contract.entry.format === 'openapi3.1') {
    return structuredClone(schema) as Schema;
  }
  const converted = openapiSchemaToJsonSchema(wrapTypelessNullable(schema) as never) as Schema;
  delete converted.$schema;
  return converted;
}

const COMPOSITION_KEYS = ['allOf', 'anyOf', 'oneOf'] as const;
const CONDITIONAL_KEYS = ['if', 'then', 'else'] as const;

function isObjectType(schema: Schema): boolean {
  return schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object'));
}

function toOpenRef(member: unknown): void {
  if (isSchema(member) && typeof member.$ref === 'string' && member.$ref.startsWith(COMPONENT_REF)) {
    member.$ref = OPEN_COMPONENT_REF + member.$ref.slice(COMPONENT_REF.length);
  }
}

// Unknown properties must fail even where specs allow them (spec §Contract check). unevaluatedProperties
// is set on the outermost schema only, so properties declared by composition members (allOf/anyOf/oneOf,
// if/then/else, dependentSchemas) still count; those members point to the open variant of components.
function strictify(schema: unknown, compositionMember: boolean): void {
  if (!isSchema(schema)) {
    return;
  }
  const isMap = isSchema(schema.additionalProperties);
  const closed = schema.additionalProperties === false;
  if (typeof schema.additionalProperties === 'boolean') {
    delete schema.additionalProperties;
  }
  const composes =
    COMPOSITION_KEYS.some((key) => Array.isArray(schema[key])) || 'if' in schema || isSchema(schema.dependentSchemas);
  if ((schema.properties || composes || closed || isObjectType(schema)) && !compositionMember && !isMap) {
    schema.unevaluatedProperties = false;
  }

  for (const key of ['properties', 'patternProperties'] as const) {
    if (isSchema(schema[key])) {
      Object.values(schema[key]).forEach((child) => strictify(child, false));
    }
  }
  if (isMap) {
    strictify(schema.additionalProperties, false);
  }
  for (const key of ['items', 'additionalItems', 'not', 'contains']) {
    strictify(schema[key], false);
  }
  if (Array.isArray(schema.prefixItems)) {
    schema.prefixItems.forEach((child) => strictify(child, false));
  }
  for (const key of COMPOSITION_KEYS) {
    const members = schema[key];
    if (Array.isArray(members)) {
      for (const member of members) {
        toOpenRef(member);
        strictify(member, true);
      }
    }
  }
  for (const key of CONDITIONAL_KEYS) {
    toOpenRef(schema[key]);
    strictify(schema[key], true);
  }
  if (isSchema(schema.dependentSchemas)) {
    for (const member of Object.values(schema.dependentSchemas)) {
      toOpenRef(member);
      strictify(member, true);
    }
  }
}

function rewriteRefs(value: unknown, base: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => rewriteRefs(item, base));
    return;
  }
  if (!isSchema(value)) {
    return;
  }
  if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
    value.$ref = `${base}${value.$ref}`;
  }
  Object.values(value).forEach((child) => rewriteRefs(child, base));
}

function contractId(contract: Contract): string {
  return `contract:${contract.service}`;
}

function getCompiled(contract: Contract): CompiledContract {
  const existing = compiled.get(contract);
  if (existing) {
    return existing;
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const format of ['int32', 'int64', 'float', 'double']) {
    ajv.addFormat(format, { type: 'number', validate: () => true });
  }
  ajv.addFormat('date-span', { type: 'string', validate: () => true });

  const rawSchemas = Object.entries(contract.spec.components?.schemas ?? {});
  const variant = (open: boolean): Record<string, Schema> =>
    Object.fromEntries(
      rawSchemas.map(([name, schema]) => {
        const converted = toJsonSchema(contract, schema);
        strictify(converted, open);
        return [name, converted];
      })
    );
  ajv.addSchema({ $id: contractId(contract), components: { schemas: variant(false), openSchemas: variant(true) } });

  const entry = { ajv, validators: new Map<string, ValidateFunction>() };
  compiled.set(contract, entry);
  return entry;
}

export function findOperation(contract: Contract, method: 'get', calledPath: string): OperationMatch | undefined {
  let path = stripQuery(calledPath);
  const prefix = contract.entry.pathPrefix;
  if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) {
    path = path.slice(prefix.length);
  }

  const paths = contract.spec.paths;
  const pick = (specPath: string): OperationMatch | undefined => {
    const operation = paths[specPath]?.[method];
    return isSchema(operation) ? { specPath, operation } : undefined;
  };

  return pick(path) ?? Object.keys(paths).filter((p) => matchPathTemplate(p, path)).map(pick).find(Boolean);
}

function isJsonMediaType(mediaType: string): boolean {
  const base = mediaType.split(';')[0].trim().toLowerCase();
  return base === 'application/json' || base.endsWith('+json');
}

function jsonResponseSchema(operation: Record<string, unknown>): unknown {
  const responses = operation.responses as Record<string, Schema> | undefined;
  for (const status of ['200', 'default']) {
    const content = responses?.[status]?.content;
    if (isSchema(content)) {
      const mediaType = Object.keys(content).find(isJsonMediaType);
      if (mediaType) {
        return (content[mediaType] as Schema).schema;
      }
    }
  }
  return undefined;
}

function formatError(error: ErrorObject): string {
  const where = error.instancePath || '/';
  const extra = error.params.unevaluatedProperty ? ` (${error.params.unevaluatedProperty})` : '';
  return `${where} ${error.message}${extra}`;
}

export function validateAgainstContract(
  contract: Contract,
  method: 'get',
  calledPath: string,
  body: unknown
): string[] {
  const match = findOperation(contract, method, calledPath);
  if (!match) {
    return [`no ${method.toUpperCase()} operation for ${stripQuery(calledPath)}`];
  }
  const schema = jsonResponseSchema(match.operation);
  if (schema === undefined) {
    return [`no application/json 200 response schema for ${method.toUpperCase()} ${match.specPath}`];
  }

  const { ajv, validators } = getCompiled(contract);
  let validate = validators.get(match.specPath);
  if (!validate) {
    const converted = toJsonSchema(contract, schema);
    strictify(converted, false);
    rewriteRefs(converted, contractId(contract));
    validate = ajv.compile(converted);
    validators.set(match.specPath, validate);
  }

  return validate(body) ? [] : (validate.errors ?? []).map(formatError);
}

export function validateResponse(service: ServiceId, method: 'get', calledPath: string, body: unknown): string[] {
  return validateAgainstContract(loadContract(service), method, calledPath, body);
}

export function assertMatchesContract(service: ServiceId, method: 'get', calledPath: string, body: unknown): void {
  const errors = validateResponse(service, method, calledPath, body);
  if (errors.length > 0) {
    throw new Error(`Response for GET ${calledPath} breaks the ${service} contract:\n  ${errors.join('\n  ')}`);
  }
}
