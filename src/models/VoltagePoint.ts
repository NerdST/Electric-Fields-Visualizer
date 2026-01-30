import * as THREE from 'three';

export interface VoltagePoint {
  position: THREE.Vector3;
  voltage: number; 
  id: string;
}

export function createVoltagePoint(
  position: THREE.Vector3,
  voltage: number = 0,
  id: string = `voltage-${Date.now()}`
): VoltagePoint {
  return {
    position: position.clone(),
    voltage,
    id,
  };
}

