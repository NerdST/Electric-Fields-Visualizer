import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Charge } from '../models/Charge';
import { type SourceWaveformType } from '../models/SimulationSource';
import {
  createDefaultPointCharge,
  getAllDescriptors,
  getDescriptor,
  type SimObject,
  type SimObjectKind,
  type SimObjectRenderer,
  type PointChargeObject,
} from '../models/simobject';

function createInitialObjects(): SimObject[] {
  return [createDefaultPointCharge('charge-1')];
}

export interface SimObjectsState {
  objects: SimObject[];
  pointCharges: PointChargeObject[];
  objectStack: string[];
  chargesState: Charge[];
  chargesRef: React.MutableRefObject<Charge[]>;
  renderersRef: React.MutableRefObject<Map<SimObjectKind, SimObjectRenderer<any>>>;
  addPointCharge: () => void;
  removeLastAdded: () => void;
  removeAllCharges: () => void;
  removeObject: (id: string) => void;
  updateObject: <T extends SimObject>(id: string, patch: Partial<T>) => void;
  updatePointChargeWaveform: (
    id: string,
    field: 'type' | 'offset' | 'amplitude' | 'frequencyHz' | 'phaseRad' | 'dutyCycle',
    value: number | SourceWaveformType,
  ) => void;
  updatePointChargePosition: (id: string, pos: THREE.Vector3) => void;
  setObjectVisible: (id: string, visible: boolean) => void;
}

export interface UseSimObjectsArgs {
  scene: THREE.Scene;
  timeSeconds: number;
  selectedObjectId: string | null;
  onEvaluatedChargesChanged: (charges: Charge[]) => void;
}

/**
 * Single source of truth for every placeable object in the scene.
 *
 * Owns:
 *   - The `objects: SimObject[]` list
 *   - The per-tick "evaluate → group-by-kind → sync renderers" loop
 *   - One renderer instance per registered kind
 *   - CRUD for point charges (other kinds come online in later slices)
 *
 * Downstream consumers (SimulationProvider, VectorFieldRenderer, FieldLineRenderer) receive
 * the evaluated `Charge[]` via the `onEvaluatedChargesChanged` callback.
 */
export function useSimObjects(args: UseSimObjectsArgs): SimObjectsState {
  const { scene, timeSeconds, selectedObjectId, onEvaluatedChargesChanged } = args;

  const [objects, setObjects] = useState<SimObject[]>(createInitialObjects);
  const [objectStack, setObjectStack] = useState<string[]>([]);
  const [chargesState, setChargesState] = useState<Charge[]>([]);
  const chargesRef = useRef<Charge[]>([]);

  const renderersRef = useRef<Map<SimObjectKind, SimObjectRenderer<any>>>(new Map());
  useEffect(() => {
    const map = new Map<SimObjectKind, SimObjectRenderer<any>>();
    for (const descriptor of getAllDescriptors()) {
      map.set(descriptor.kind, descriptor.createRenderer(scene));
    }
    renderersRef.current = map;
    return () => {
      for (const r of map.values()) r.dispose();
      renderersRef.current = new Map();
    };
  }, [scene]);

  const prevEvaluatedRef = useRef<Charge[]>([]);

  useEffect(() => {
    const evaluated: Charge[] = [];
    for (const obj of objects) {
      const d = getDescriptor(obj.kind);
      const c = d?.evaluateCharge?.(obj, timeSeconds);
      if (c) evaluated.push(c);
    }

    // Change detection — skip resampling for DC sources that haven't moved.
    const prev = prevEvaluatedRef.current;
    const changed =
      evaluated.length !== prev.length ||
      evaluated.some((c, i) => {
        const p = prev[i];
        return c.magnitude !== p.magnitude || !c.position.equals(p.position);
      });
    prevEvaluatedRef.current = evaluated;

    const byKind = new Map<SimObjectKind, SimObject[]>();
    for (const obj of objects) {
      const arr = byKind.get(obj.kind) ?? [];
      arr.push(obj);
      byKind.set(obj.kind, arr);
    }
    for (const [kind, r] of renderersRef.current) {
      r.sync(byKind.get(kind) ?? [], selectedObjectId, timeSeconds);
    }

    if (changed) {
      chargesRef.current = evaluated;
      setChargesState(evaluated);
      onEvaluatedChargesChanged(evaluated);
    }
  }, [objects, timeSeconds, selectedObjectId, onEvaluatedChargesChanged]);

  const addPointCharge = useCallback(() => {
    const obj = createDefaultPointCharge(`charge-${Date.now()}`);
    obj.position.set(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
    );
    obj.waveform.offset = Math.random() > 0.5 ? 1e-6 : -1e-6;
    setObjects((prev) => [...prev, obj]);
    setObjectStack((prev) => [...prev, obj.id]);
  }, []);

  const removeObject = useCallback((id: string) => {
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setObjectStack((prev) => prev.filter((x) => x !== id));
  }, []);

  const removeLastAdded = useCallback(() => {
    setObjectStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setObjects((os) => os.filter((o) => o.id !== last));
      return prev.slice(0, -1);
    });
  }, []);

  const removeAllCharges = useCallback(() => {
    setObjects((prev) => prev.filter((o) => o.kind !== 'pointCharge'));
    setObjectStack([]);
  }, []);

  const updateObject = useCallback(<T extends SimObject>(id: string, patch: Partial<T>) => {
    setObjects((prev) => prev.map((o) => (o.id === id ? ({ ...o, ...patch } as SimObject) : o)));
  }, []);

  const updatePointChargeWaveform = useCallback(
    (
      id: string,
      field: 'type' | 'offset' | 'amplitude' | 'frequencyHz' | 'phaseRad' | 'dutyCycle',
      value: number | SourceWaveformType,
    ) => {
      setObjects((prev) => prev.map((o) => {
        if (o.id !== id || o.kind !== 'pointCharge') return o;
        return { ...o, waveform: { ...o.waveform, [field]: value } };
      }));
    },
    [],
  );

  const updatePointChargePosition = useCallback((id: string, pos: THREE.Vector3) => {
    setObjects((prev) => prev.map((o) => {
      if (o.id !== id || o.kind !== 'pointCharge') return o;
      return { ...o, position: pos.clone() };
    }));
  }, []);

  const setObjectVisible = useCallback((id: string, visible: boolean) => {
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, visible } : o)));
  }, []);

  const pointCharges = objects.filter(
    (o): o is PointChargeObject => o.kind === 'pointCharge',
  );

  return {
    objects, pointCharges, objectStack,
    chargesState, chargesRef, renderersRef,
    addPointCharge, removeLastAdded, removeAllCharges, removeObject,
    updateObject, updatePointChargeWaveform, updatePointChargePosition,
    setObjectVisible,
  };
}
