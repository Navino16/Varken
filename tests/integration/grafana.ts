import axios from 'axios';
import type { GrafanaTarget } from '../../src/dashboards/translators';
import type { OutputType } from './setup';

export const GRAFANA = { url: 'http://localhost:3000', user: 'admin', password: 'admin' };

const api = axios.create({ baseURL: GRAFANA.url, auth: { username: GRAFANA.user, password: GRAFANA.password } });

const DATASOURCES: Record<OutputType, object> = {
  influxdb1: {
    type: 'influxdb',
    access: 'proxy',
    url: 'http://varken-influxdb1:8086',
    user: 'varken',
    jsonData: { dbName: 'varken', httpMode: 'POST' },
    secureJsonData: { password: 'varkenpassword' },
  },
  influxdb2: {
    type: 'influxdb',
    access: 'proxy',
    url: 'http://varken-influxdb2:8086',
    jsonData: { version: 'Flux', organization: 'varken', defaultBucket: 'varken' },
    secureJsonData: { token: 'varken-test-token' },
  },
  victoriametrics: { type: 'prometheus', access: 'proxy', url: 'http://varken-victoriametrics:8428', jsonData: { httpMethod: 'POST' } },
  questdb: {
    type: 'grafana-postgresql-datasource',
    access: 'proxy',
    url: 'varken-questdb:8812',
    user: 'admin',
    jsonData: { database: 'qdb', sslmode: 'disable' },
    secureJsonData: { password: 'quest' },
  },
  timescaledb: {
    type: 'grafana-postgresql-datasource',
    access: 'proxy',
    url: 'varken-timescaledb:5432',
    user: 'varken',
    jsonData: { database: 'varken', sslmode: 'disable', timescaledb: true },
    secureJsonData: { password: 'varken' },
  },
};

/** Datasource of the test Grafana pointing at an output of `docker-compose.test.yaml`; returns its uid. */
export async function ensureDatasource(output: OutputType): Promise<string> {
  const uid = `varken-it-${output}`;
  const body = { name: uid, uid, ...DATASOURCES[output] };
  const existing = await api.get(`/api/datasources/uid/${uid}`, { validateStatus: () => true });
  if (existing.status === 200) {
    await api.put(`/api/datasources/uid/${uid}`, body);
  } else {
    await api.post('/api/datasources', body);
  }
  return uid;
}

interface Frame {
  schema: { fields: { name: string; labels?: Record<string, string>; config?: { displayNameFromDS?: string } }[] };
  data: { values: unknown[][] };
}

/**
 * Runs one panel target through Grafana as the panel would. `rows` counts rows holding a non-null value besides the first
 * column; `names` are the field names, display names and label keys the panel transformations can match.
 */
export async function runTarget(
  target: GrafanaTarget,
  uid: string,
  panel: { timeFrom?: string; interval?: string }
): Promise<{ error?: string; rows: number; names: string[] }> {
  const intervalMs = panel.interval ? Number.parseInt(panel.interval, 10) * 1000 : 60_000;
  const response = await api.post<{ results: Record<string, { error?: string; frames?: Frame[] }> }>(
    '/api/ds/query',
    {
      from: panel.timeFrom ? `now-${panel.timeFrom}` : 'now-7d',
      to: 'now',
      queries: [{ ...target, datasource: { ...target.datasource, uid }, intervalMs, maxDataPoints: 500 }],
    },
    { validateStatus: () => true }
  );
  const result = response.data.results?.[target.refId];
  const rows = (result?.frames ?? []).reduce((sum, { data: { values } }) => {
    const columns = values.slice(1);
    return sum + (values[0] ?? []).filter((_value, row) => columns.some((column) => column[row] !== null && column[row] !== undefined)).length;
  }, 0);
  const names = (result?.frames ?? []).flatMap((frame) =>
    frame.schema.fields.flatMap((field) => [field.name, field.config?.displayNameFromDS ?? field.name, ...Object.keys(field.labels ?? {})])
  );
  return { error: result?.error ?? (response.status === 200 ? undefined : `HTTP ${response.status}`), rows, names };
}

/** Imports a generated dashboard into the test Grafana with its datasource bound; returns its URL path. */
export async function importDashboard(dashboard: object, uid: string): Promise<string> {
  const bound = JSON.parse(JSON.stringify(dashboard).replaceAll('${DS_VARKEN}', uid));
  const response = await api.post<{ url: string }>('/api/dashboards/db', { dashboard: bound, overwrite: true });
  return response.data.url;
}
