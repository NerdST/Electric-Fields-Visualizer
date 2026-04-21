import * as THREE from 'three';
import type { SourceWaveform } from '../SimulationSource';

export type SimObjectKind =
  | 'pointCharge'
  | 'voltageProbe'
  | 'lineCurrent'
  | 'currentLoop'
  | 'solenoid'
  | 'fluxSurface'
  | 'fieldProbe';

export interface SimObjectBase {
  id: string;
  kind: SimObjectKind;
  name: string;
  visible: boolean;
}

export interface PointChargeObject extends SimObjectBase {
  kind: 'pointCharge';
  position: THREE.Vector3;
  waveform: SourceWaveform;
}

export type SimObject = PointChargeObject;
