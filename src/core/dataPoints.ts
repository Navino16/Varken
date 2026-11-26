import type { DataPoint } from '../types/plugin.types';

/** Points an output can store: a measurement, at least one field and a valid timestamp; others are warned about and dropped. */
export function validDataPoints(points: DataPoint[], scheduleName: string, warn: (message: string) => void): DataPoint[] {
  return points.filter((point) => {
    if (!point.measurement || typeof point.measurement !== 'string') {
      warn(`[${scheduleName}] Filtered out data point with empty or invalid measurement`);
      return false;
    }
    if (!point.fields || Object.keys(point.fields).length === 0) {
      warn(`[${scheduleName}] Filtered out data point "${point.measurement}" with no fields`);
      return false;
    }
    if (!(point.timestamp instanceof Date) || Number.isNaN(point.timestamp.getTime())) {
      warn(`[${scheduleName}] Filtered out data point "${point.measurement}" with invalid timestamp`);
      return false;
    }
    return true;
  });
}
