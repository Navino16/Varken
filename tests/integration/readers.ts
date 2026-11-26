import axios from 'axios';
import { InfluxDB as Influx1 } from 'influx';
import { InfluxDB as Influx2 } from '@influxdata/influxdb-client';
import { Client } from 'pg';
import { testOutputConfigs, type OutputType } from './setup';

async function influx1Measurements(): Promise<string[]> {
  const { url, port, username, password, database } = testOutputConfigs().influxdb1;
  return new Influx1({ host: url, port, username, password, database }).getMeasurements();
}

async function influx2Measurements(): Promise<string[]> {
  const { url, port, token, org, bucket } = testOutputConfigs().influxdb2;
  const query = `import "influxdata/influxdb/schema"\nschema.measurements(bucket: "${bucket}", start: -10y)`;
  const rows = await new Influx2({ url: `http://${url}:${port}`, token }).getQueryApi(org).collectRows<{ _value: string }>(query);
  return rows.map((row) => row._value);
}

async function victoriaMetricsMeasurements(): Promise<string[]> {
  const { url, port } = testOutputConfigs().victoriametrics;
  const response = await axios.get<{ data: string[] }>(`http://${url}:${port}/api/v1/label/__name__/values`, { params: { start: 0 } });
  return response.data.data.map((metric) => metric.split('_')[0]);
}

async function questDbMeasurements(): Promise<string[]> {
  const { url, port } = testOutputConfigs().questdb;
  const response = await axios.get<{ columns: { name: string }[]; dataset: unknown[][] }>(`http://${url}:${port}/exec`, {
    params: { query: 'tables()' },
  });
  const column = response.data.columns.findIndex((c) => c.name === 'table_name');
  return response.data.dataset.map((row) => String(row[column]));
}

async function timescaleMeasurements(): Promise<string[]> {
  const { host, port, database, username, password } = testOutputConfigs().timescaledb;
  const client = new Client({ host, port, database, user: username, password });
  await client.connect();
  try {
    const result = await client.query<{ measurement: string }>('SELECT DISTINCT measurement FROM varken_events');
    return result.rows.map((row) => row.measurement);
  } finally {
    await client.end();
  }
}

const readers: Record<OutputType, () => Promise<string[]>> = {
  influxdb1: influx1Measurements,
  influxdb2: influx2Measurements,
  victoriametrics: victoriaMetricsMeasurements,
  questdb: questDbMeasurements,
  timescaledb: timescaleMeasurements,
};

/** Measurement names stored by an output of `docker-compose.test.yaml` (VictoriaMetrics: metric name before the first `_`). */
export async function listMeasurements(type: OutputType): Promise<string[]> {
  return [...new Set(await readers[type]())].sort();
}
