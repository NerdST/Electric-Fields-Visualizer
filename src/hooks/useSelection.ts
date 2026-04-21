import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SimObjectKind, SimObjectRenderer } from '../models/simobject';

export interface HoverState {
  hoverPosition: THREE.Vector3 | null;
  hoverVoltage: number | null;
}

export interface UseSelectionArgs {
  domElement: HTMLElement;
  camera: THREE.Camera;
  hasControls: () => boolean;
  renderersRef: React.MutableRefObject<Map<SimObjectKind, SimObjectRenderer<any>>>;
  setSelectedObjectId: (id: string | null) => void;
  samplePotentialAt: (pos: THREE.Vector3) => number;
  /** Extra meshes to raycast against (legacy voltage-point fallback; removed in Slice D). */
  extraSelectableMeshes?: () => THREE.Object3D[];
  onVoltagePointClick?: (voltagePointId: string) => void;
  onEmptyClick?: () => void;
}

/**
 * Binds click + mousemove listeners to the canvas. Click hits are resolved by walking every
 * registered SimObjectRenderer's selectable meshes — no per-kind knowledge in the controller.
 * Selected-object id is owned by the caller so it can be passed to `useSimObjects` for
 * renderer-sync invalidation.
 */
export function useSelection(args: UseSelectionArgs): HoverState {
  const {
    domElement, camera, hasControls, renderersRef, setSelectedObjectId,
    samplePotentialAt, extraSelectableMeshes, onVoltagePointClick, onEmptyClick,
  } = args;

  const [hoverPosition, setHoverPosition] = useState<THREE.Vector3 | null>(null);
  const [hoverVoltage, setHoverVoltage] = useState<number | null>(null);

  const samplePotentialRef = useRef(samplePotentialAt);
  useEffect(() => { samplePotentialRef.current = samplePotentialAt; }, [samplePotentialAt]);
  const extraMeshesRef = useRef(extraSelectableMeshes);
  useEffect(() => { extraMeshesRef.current = extraSelectableMeshes; }, [extraSelectableMeshes]);
  const onVoltagePointClickRef = useRef(onVoltagePointClick);
  useEffect(() => { onVoltagePointClickRef.current = onVoltagePointClick; }, [onVoltagePointClick]);
  const onEmptyClickRef = useRef(onEmptyClick);
  useEffect(() => { onEmptyClickRef.current = onEmptyClick; }, [onEmptyClick]);
  const setSelectedRef = useRef(setSelectedObjectId);
  useEffect(() => { setSelectedRef.current = setSelectedObjectId; }, [setSelectedObjectId]);

  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const moveRaycaster = new THREE.Raycaster();
    const moveMouse = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const handleClick = (event: MouseEvent) => {
      if (!hasControls()) return;
      const rect = domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      const simObjectMeshes: THREE.Object3D[] = [];
      for (const r of renderersRef.current.values()) {
        simObjectMeshes.push(...r.getSelectableMeshes());
      }
      const objectHits = raycaster.intersectObjects(simObjectMeshes);

      const extra = extraMeshesRef.current?.() ?? [];
      const extraHits = extra.length > 0 ? raycaster.intersectObjects(extra) : [];

      if (objectHits.length > 0) {
        const id = objectHits[0].object.userData.simObjectId as string | undefined;
        if (id) setSelectedRef.current(id);
      } else if (extraHits.length > 0) {
        const vpId = extraHits[0].object.userData.voltagePointId as string | undefined;
        if (vpId) onVoltagePointClickRef.current?.(vpId);
      } else {
        setSelectedRef.current(null);
        onEmptyClickRef.current?.();
      }
    };

    const handleMove = (event: MouseEvent) => {
      const rect = domElement.getBoundingClientRect();
      moveMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      moveMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      moveRaycaster.setFromCamera(moveMouse, camera);
      const hit = new THREE.Vector3();
      const result = moveRaycaster.ray.intersectPlane(groundPlane, hit);
      if (result !== null) {
        const pos = hit.clone();
        setHoverPosition(pos);
        setHoverVoltage(samplePotentialRef.current(pos));
      } else {
        setHoverPosition(null);
        setHoverVoltage(null);
      }
    };

    domElement.addEventListener('click', handleClick);
    domElement.addEventListener('mousemove', handleMove);
    return () => {
      domElement.removeEventListener('click', handleClick);
      domElement.removeEventListener('mousemove', handleMove);
    };
  }, [domElement, camera, hasControls, renderersRef]);

  return { hoverPosition, hoverVoltage };
}
