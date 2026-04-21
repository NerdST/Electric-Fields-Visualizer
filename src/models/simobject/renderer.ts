import * as THREE from 'three';
import type { SimObject } from './types';

/**
 * Per-object-type renderer. One instance per SimObject kind, not per object.
 * The instance owns all meshes for all objects of that kind.
 */
export interface SimObjectRenderer<T extends SimObject> {
  /**
   * Called whenever object state changes. Adds new meshes, updates existing, removes missing.
   * `timeSeconds` lets renderers reflect instantaneous waveform state (e.g. charge sign flipping
   * under a sine source) without the controller having to pre-evaluate everything.
   */
  sync(objects: T[], selectedId: string | null, timeSeconds: number): void;

  /** Meshes eligible for raycast selection. Each mesh should have `userData.simObjectId` set. */
  getSelectableMeshes(): THREE.Object3D[];

  /** Tear down all meshes, geometries, materials owned by this renderer. */
  dispose(): void;
}
