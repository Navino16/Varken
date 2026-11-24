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

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJsonSchema(contract: Contract, schema: unknown): Schema {
  if (contract.entry.format === 'openapi3.1') {
    return structuredClone(schema) as Schema;
  }
  const converted = openapiSchemaToJsonSchema(schema as never) as Schema;
  delete converted.$schema;
  return converted;
}

function collectAllOfRefs(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectAllOfRefs(item, refs));
    return;
  }
  if (!isSchema(value)) {
    return;
  }
  if (Array.isArray(value.allOf)) {
    for (const member of value.allOf) {
      if (isSchema(member) && typeof member.$ref === 'string' && member.$ref.startsWith(COMPONENT_REF)) {
        refs.add(member.$ref.slice(COMPONENT_REF.length));
      }
    }
  }
  Object.values(value).forEach((child) => collectAllOfRefs(child, refs));
}

// Unknown properties must fail even where specs allow them (spec §Contract check). unevaluatedProperties
// is used instead of additionalProperties so allOf compositions still see their members' properties.
function strictify(schema: unknown, allOfMember: boolean): void {
  if (!isSchema(schema)) {
    return;
  }
  const isMap = isSchema(schema.additionalProperties);
  if (typeof schema.additionalProperties === 'boolean') {
    delete schema.additionalProperties;
  }
  if ((schema.properties || schema.allOf) && !allOfMember && !isMap) {
    schema.unevaluatedProperties = false;
  }

  if (isSchema(schema.properties)) {
    Object.values(schema.properties).forEach((child) => strictify(child, false));
  }
  if (isMap) {
    strictify(schema.additionalProperties, false);
  }
  for (const key of ['items', 'not', 'contains']) {
    strictify(schema[key], false);
  }
  for (const key of ['anyOf', 'oneOf', 'prefixItems']) {
    if (Array.isArray(schema[key])) {
      (schema[key] as unknown[]).forEach((child) => strictify(child, false));
    }
  }
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((child) => strictify(child, true));
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

  const rawSchemas = contract.spec.components?.schemas ?? {};
  const allOfRefs = new Set<string>();
  collectAllOfRefs(contract.spec, allOfRefs);
  const schemas = Object.fromEntries(
    Object.entries(rawSchemas).map(([name, schema]) => {
      const converted = toJsonSchema(contract, schema);
      strictify(converted, allOfRefs.has(name));
      return [name, converted];
    })
  );
  ajv.addSchema({ $id: contractId(contract), components: { schemas } });

  const entry = { ajv, validators: new Map<string, ValidateFunction>() };
  compiled.set(contract, entry);
  return entry;
}

export function findOperation(contract: Contract, method: 'get', calledPath: string): OperationMatch | undefined {
  let path = stripQuery(calledPath);
  const prefix = contract.entry.pathPrefix;
  if (prefix && path.startsWith(prefix)) {
    path = path.slice(prefix.length);
  }

  const paths = contract.spec.paths;
  const pick = (specPath: string): OperationMatch | undefined => {
    const operation = paths[specPath]?.[method];
    return isSchema(operation) ? { specPath, operation } : undefined;
  };

  return pick(path) ?? Object.keys(paths).filter((p) => matchPathTemplate(p, path)).map(pick).find(Boolean);
}

function jsonResponseSchema(operation: Record<string, unknown>): unknown {
  const responses = operation.responses as Record<string, Schema> | undefined;
  const content = responses?.['200']?.content as Record<string, Schema> | undefined;
  return content?.['application/json']?.schema;
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
