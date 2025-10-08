import * as THREE from 'three';

export interface Charge {
  position: THREE.Vector3;
  magnitude: number; // in Coulombs
  id: string;
}

export interface ElectricFieldResult {
  field: THREE.Vector3;
  potential: number;
}

// Physical constants
export const PHYSICS_CONSTANTS = {
  K: 8.9875517923e9, // Coulomb's constant (N⋅m²/C²)
  EPSILON_0: 8.854187817e-12, // Vacuum permittivity (F/m)
  SOFTENING_FACTOR: 0.1, // Small distance to avoid singularities
} as const;

/**
 * Calculate electric field at a point due to a single charge
 */
export function electricFieldFromCharge(
  position: THREE.Vector3,
  charge: Charge
): ElectricFieldResult {
  const r = position.clone().sub(charge.position);
  const distance = r.length();

  // Apply softening to avoid singularities
  const effectiveDistance = Math.max(distance, PHYSICS_CONSTANTS.SOFTENING_FACTOR);

  const fieldMagnitude = (PHYSICS_CONSTANTS.K * charge.magnitude) / (effectiveDistance * effectiveDistance);
  const field = r.normalize().multiplyScalar(fieldMagnitude);

  const potential = (PHYSICS_CONSTANTS.K * charge.magnitude) / effectiveDistance;

  return { field, potential };
}

/**
 * Calculate electric field at a point due to multiple charges (superposition)
 */
export function electricFieldAt(
  position: THREE.Vector3,
  charges: Charge[]
): ElectricFieldResult {
  const totalField = new THREE.Vector3(0, 0, 0);
  let totalPotential = 0;

  for (const charge of charges) {
    const result = electricFieldFromCharge(position, charge);
    totalField.add(result.field);
    totalPotential += result.potential;
  }

  return { field: totalField, potential: totalPotential };
}

/**
 * Create a default charge at the origin
 */
export function createDefaultCharge(id: string = 'charge-1'): Charge {
  return {
    position: new THREE.Vector3(0, 0, 0),
    magnitude: 1e-6, // 1 microCoulomb
    id,
  };
}

/**
 * Create a charge with specified parameters
 */
export function createCharge(
  position: THREE.Vector3,
  magnitude: number,
  id: string
): Charge {
  return {
    position: position.clone(),
    magnitude,
    id,
  };
}
