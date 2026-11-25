/**
 * Timestamp of an event point. The APIs report whole seconds, so the record id's last three digits go in
 * the milliseconds: events of the same second with identical tags stay distinct points in InfluxDB.
 */
export function eventTimestamp(time: number, id: number | undefined): Date {
  return new Date(time + (Number.isInteger(id) ? Math.abs(id as number) % 1000 : 0));
}
