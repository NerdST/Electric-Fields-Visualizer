import * as THREE from 'three';
import { electricFieldAt } from './Charge';
import type { Charge } from './Charge';

export interface LineProbeDataPoint {
  distance: number;       // cumulative distance along the path
  position: THREE.Vector3;
  voltage: number;
  fieldMagnitude: number;
}

export interface LineProbeResult {
  waypoints: THREE.Vector3[];
  totalDistance: number;
  data: LineProbeDataPoint[];
}

/**
 * Sample potential and field magnitude along a polyline path.
 * `samplesPerSegment` controls how many evenly spaced samples are taken
 * between each pair of consecutive waypoints.
 */
export function computeLineProbe(
  waypoints: THREE.Vector3[],
  charges: Charge[],
  samplesPerSegment: number = 30
): LineProbeResult {
  if (waypoints.length < 2) {
    return { waypoints: [...waypoints], totalDistance: 0, data: [] };
  }

  const data: LineProbeDataPoint[] = [];
  let cumulativeDistance = 0;

  for (let seg = 0; seg < waypoints.length - 1; seg++) {
    const a = waypoints[seg];
    const b = waypoints[seg + 1];
    const segmentLength = a.distanceTo(b);

    // Skip first point on non-first segments to avoid duplicates at joints
    const startI = seg === 0 ? 0 : 1;

    for (let i = startI; i <= samplesPerSegment; i++) {
      const t = i / samplesPerSegment;
      const pos = a.clone().lerp(b.clone(), t);

      const fieldResult = electricFieldAt(pos, charges);

      data.push({
        distance: cumulativeDistance + segmentLength * t,
        position: pos,
        voltage: fieldResult.potential,
        fieldMagnitude: fieldResult.field.length(),
      });
    }

    cumulativeDistance += segmentLength;
  }

  return {
    waypoints: waypoints.map(w => w.clone()),
    totalDistance: cumulativeDistance,
    data,
  };
}
