import * as THREE from 'three';
import { electricFieldAt } from './Charge';
import type { Charge } from './Charge';

export interface TwoPointProbeResult {
  pointA: THREE.Vector3;
  pointB: THREE.Vector3;
  voltageA: number;
  voltageB: number;
  deltaV: number;
  distance: number;
  eDotDl: number; // This will hold the line integral of E·dl from A to B
}

/**
 * This will numerically integrate E·dl along the straight-line segment from A to B.
 * it uses the trapezoidal rule with `samples` evenly spaced points.
 */
export function computeTwoPointProbe(
  pointA: THREE.Vector3,
  pointB: THREE.Vector3,
  charges: Charge[],
  samples: number = 50
): TwoPointProbeResult {
  const fieldA = electricFieldAt(pointA, charges);
  const fieldB = electricFieldAt(pointB, charges);

  const distance = pointA.distanceTo(pointB);
  const deltaV = fieldB.potential - fieldA.potential;

  // Integrate E·dl along the segment A to B
  const dl = pointB.clone().sub(pointA).divideScalar(samples);
  const dlDir = dl.clone().normalize();
  let eDotDl = 0;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pos = pointA.clone().lerp(pointB.clone(), t);
    const fieldResult = electricFieldAt(pos, charges);
    const eDotDlSample = fieldResult.field.dot(dlDir);

    // Trapezoidal rule: half-weight at endpoints
    const weight = (i === 0 || i === samples) ? 0.5 : 1.0;
    eDotDl += eDotDlSample * weight;
  }
  // multiply by step size
  eDotDl *= dl.length();

  return {
    pointA: pointA.clone(),
    pointB: pointB.clone(),
    voltageA: fieldA.potential,
    voltageB: fieldB.potential,
    deltaV,
    distance,
    eDotDl,
  };
}
