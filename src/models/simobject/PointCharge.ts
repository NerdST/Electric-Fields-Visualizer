import * as THREE from 'three';
import type { Charge } from '../Charge';
import { evaluateWaveform } from '../SimulationSource';
import type { PointChargeObject } from './types';
import { register, type SimObjectDescriptor } from './registry';
import { PointChargeRenderer } from './renderers/PointChargeRenderer';

export function createDefaultPointCharge(id: string): PointChargeObject {
  return {
    id,
    kind: 'pointCharge',
    name: id,
    visible: true,
    position: new THREE.Vector3(0, 0, 0),
    waveform: {
      type: 'dc',
      offset: 1e-6,
      amplitude: 0,
      frequencyHz: 1,
      phaseRad: 0,
      dutyCycle: 0.5,
    },
  };
}

const descriptor: SimObjectDescriptor<PointChargeObject> = {
  kind: 'pointCharge',
  displayName: 'Point Charge',
  icon: '●',

  createDefault: createDefaultPointCharge,

  evaluateCharge(obj, timeSeconds): Charge {
    return {
      id: obj.id,
      position: obj.position.clone(),
      magnitude: evaluateWaveform(obj.waveform, timeSeconds),
    };
  },

  createRenderer(scene) {
    return new PointChargeRenderer(scene);
  },
};

register(descriptor);

export { descriptor as pointChargeDescriptor };
