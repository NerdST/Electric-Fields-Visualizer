import { useCallback, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { createVoltagePoint } from '../models/VoltagePoint';
import type { VoltagePoint } from '../models/VoltagePoint';

export interface LegacyVoltagePointsState {
  points: VoltagePoint[];
  showAddUI: boolean;
  setShowAddUI: (v: boolean) => void;
  newCoords: { x: number; y: number; z: number };
  setNewCoords: (c: { x: number; y: number; z: number }) => void;
  add: () => void;
  remove: (id: string) => void;
  removeAll: () => void;
  /** Exposed for raycast selection (see useSelection's extraSelectableMeshes). */
  getSelectableMeshes: () => THREE.Object3D[];
}

export interface UseLegacyVoltagePointsArgs {
  scene: THREE.Scene;
  chargesVersion: unknown;
  sampleFieldAt: (p: THREE.Vector3) => { field: THREE.Vector3; potential: number };
  samplePotentialAt: (p: THREE.Vector3) => number;
}

/**
 * Legacy voltage-point flow. Owns state + scene meshes + recompute effect.
 * Deleted wholesale in Slice D when VoltageProbe becomes a first-class SimObject.
 */
export function useLegacyVoltagePoints(args: UseLegacyVoltagePointsArgs): LegacyVoltagePointsState {
  const { scene, chargesVersion, sampleFieldAt, samplePotentialAt } = args;

  const [points, setPoints] = useState<VoltagePoint[]>([]);
  const [showAddUI, setShowAddUI] = useState(false);
  const [newCoords, setNewCoords] = useState({ x: 0, y: 0, z: 0 });

  const meshes = useMemo(() => new Map<string, THREE.Mesh>(), []);
  const arrows = useMemo(() => new Map<string, THREE.Mesh[]>(), []);

  const geometries = useMemo(() => {
    return {
      sphere: new THREE.SphereGeometry(0.15, 12, 12),
      sphereMaterial: new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.8,
      }),
      arrow: new THREE.ConeGeometry(0.05, 0.2, 8),
      arrowMaterial: new THREE.MeshBasicMaterial({
        color: 0x4444ff,
        transparent: true,
        opacity: 0.8,
      }),
    };
  }, []);

  useEffect(() => {
    // Dispose geometries when the hook unmounts.
    return () => {
      geometries.sphere.dispose();
      geometries.sphereMaterial.dispose();
      geometries.arrow.dispose();
      geometries.arrowMaterial.dispose();
    };
  }, [geometries]);

  const syncMeshes = useCallback((pts: VoltagePoint[]) => {
    const seen = new Set<string>();
    const up = new THREE.Vector3(0, 1, 0);
    const sphereRadius = 0.15;
    const arrowScale = 2.0;
    const maxField = 1e4;
    const gridSize = 3;
    const gridStep = 0.4;
    const gridOffset = -(gridSize - 1) * gridStep / 2;

    for (const point of pts) {
      seen.add(point.id);
      let mesh = meshes.get(point.id);
      if (!mesh) {
        mesh = new THREE.Mesh(geometries.sphere, geometries.sphereMaterial);
        mesh.userData = { voltagePointId: point.id };
        scene.add(mesh);
        meshes.set(point.id, mesh);
      }
      mesh.position.copy(point.position);

      let arr = arrows.get(point.id);
      const arrowPositions: THREE.Vector3[] = [];
      for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
          for (let z = 0; z < gridSize; z++) {
            if (x === 1 && y === 1 && z === 1) continue;
            const offset = new THREE.Vector3(
              gridOffset + x * gridStep,
              gridOffset + y * gridStep,
              gridOffset + z * gridStep,
            );
            const distance = offset.length();
            if (distance > sphereRadius && distance < sphereRadius + 0.6) {
              arrowPositions.push(point.position.clone().add(offset));
            }
          }
        }
      }

      if (arr && arr.length !== arrowPositions.length) {
        for (const a of arr) scene.remove(a);
        arr = undefined;
        arrows.delete(point.id);
      }
      if (!arr) {
        arr = [];
        for (let i = 0; i < arrowPositions.length; i++) {
          const a = new THREE.Mesh(geometries.arrow, geometries.arrowMaterial);
          scene.add(a);
          arr.push(a);
        }
        arrows.set(point.id, arr);
      }

      for (let i = 0; i < arrowPositions.length && i < arr.length; i++) {
        const arrow = arr[i];
        const p = arrowPositions[i];
        const { field } = sampleFieldAt(p);
        if (field.length() < 1e-6) {
          arrow.scale.set(0, 0, 0);
          continue;
        }
        const normalized = Math.min(field.length() / maxField, 1);
        const len = Math.max(normalized * arrowScale, 0.1);
        arrow.position.copy(p);
        const dir = field.clone().normalize();
        arrow.setRotationFromQuaternion(
          new THREE.Quaternion().setFromUnitVectors(up, dir),
        );
        arrow.scale.set(1, len, 1);
      }
    }

    for (const [id, mesh] of Array.from(meshes.entries())) {
      if (!seen.has(id)) {
        scene.remove(mesh);
        meshes.delete(id);
        const arr = arrows.get(id);
        if (arr) {
          for (const a of arr) scene.remove(a);
          arrows.delete(id);
        }
      }
    }
  }, [arrows, geometries, meshes, scene, sampleFieldAt]);

  // Re-sample potential whenever the charge list changes.
  useEffect(() => {
    if (points.length === 0) return;
    const updated = points.map((p) => ({ ...p, voltage: samplePotentialAt(p.position) }));
    setPoints(updated);
    syncMeshes(updated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargesVersion]);

  useEffect(() => {
    syncMeshes(points);
  }, [points, syncMeshes]);

  const add = useCallback(() => {
    const position = new THREE.Vector3(newCoords.x, newCoords.y, newCoords.z);
    const point = createVoltagePoint(position, samplePotentialAt(position));
    setPoints((prev) => [...prev, point]);
    setShowAddUI(false);
  }, [newCoords, samplePotentialAt]);

  const remove = useCallback((id: string) => {
    setPoints((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const removeAll = useCallback(() => {
    setPoints([]);
  }, []);

  const getSelectableMeshes = useCallback(() => Array.from(meshes.values()), [meshes]);

  return {
    points, showAddUI, setShowAddUI, newCoords, setNewCoords,
    add, remove, removeAll, getSelectableMeshes,
  };
}
