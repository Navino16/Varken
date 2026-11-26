import { InputsConfigSchema, type InputsConfig } from '../../src/config/schemas/config.schema';
import { getInputPluginRegistry } from '../../src/plugins/inputs';

function enableAll(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(enableAll);
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.enabled === 'boolean') {
    record.enabled = true;
  }
  Object.values(record).forEach(enableAll);
}

/** One instance (id 1) of every registered input plugin, every collector enabled, so new collectors join the demo. */
export function demoInputs(): InputsConfig {
  const raw = Object.fromEntries(
    [...getInputPluginRegistry().keys()].map((key) => [key, [{ id: 1, url: `http://${key}.demo:80`, apiKey: 'demo', token: 'demo' }]])
  );
  const inputs = InputsConfigSchema.parse(raw);
  enableAll(inputs);
  return inputs;
}
