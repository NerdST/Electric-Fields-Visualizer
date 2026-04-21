import * as THREE from 'three';
import type { Charge } from '../Charge';
import type { SimObject, SimObjectKind } from './types';
import type { SimObjectRenderer } from './renderer';

/**
 * Describes everything the rest of the app needs to know about a SimObject kind:
 * how to create one, how to render it, and what it contributes to the simulation each tick.
 *
 * New kinds (LineCurrent, Solenoid, FluxSurface, …) are added by writing a new descriptor
 * file and calling `register()` from its module body. No controller changes required.
 */
export interface SimObjectDescriptor<T extends SimObject = SimObject> {
  kind: T['kind'];
  displayName: string;
  icon: string;

  createDefault(id: string): T;

  /** Contribution to the scalar/vector charge list consumed by SimulationProvider. */
  evaluateCharge?(obj: T, timeSeconds: number): Charge | null;

  /** Creates the renderer responsible for meshes of this kind. One per scene. */
  createRenderer(scene: THREE.Scene): SimObjectRenderer<T>;
}

const registry = new Map<SimObjectKind, SimObjectDescriptor>();

export function register<T extends SimObject>(descriptor: SimObjectDescriptor<T>): void {
  registry.set(descriptor.kind, descriptor as SimObjectDescriptor);
}

export function getDescriptor(kind: SimObjectKind): SimObjectDescriptor | undefined {
  return registry.get(kind);
}

export function getAllDescriptors(): SimObjectDescriptor[] {
  return Array.from(registry.values());
}
