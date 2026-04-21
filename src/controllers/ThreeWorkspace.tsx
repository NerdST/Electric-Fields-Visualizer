import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { electricFieldAt, type Charge } from '../models/Charge';
import { evaluateWaveform, type SourceWaveformType } from '../models/SimulationSource';
import { VectorFieldRenderer, createDefaultVectorFieldConfig } from '../views/VectorField';
import { FieldLineRenderer, createDefaultFieldLineConfig } from '../views/FieldLines';
import { createVoltagePoint } from '../models/VoltagePoint';
import type { VoltagePoint } from '../models/VoltagePoint';
import {
  createSimulationProvider,
  type SimulationMode,
  type SimulationProvider,
  type SimulationStats,
} from '../models/simulation/SimulationProvider';
import {
  createDefaultPointCharge,
  getAllDescriptors,
  getDescriptor,
  type SimObject,
  type SimObjectKind,
  type SimObjectRenderer,
  type PointChargeObject,
} from '../models/simobject';

let renderer: WebGPURenderer | THREE.WebGLRenderer;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);
let controls: OrbitControls;

if ('gpu' in navigator) {
  renderer = new WebGPURenderer({ antialias: true });
} else {
  renderer = new THREE.WebGLRenderer({ antialias: true });
}
renderer.setClearColor(0x282c34, 1);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
scene.background = new THREE.Color(0x282c34);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(0, 10, 5);
scene.add(directionalLight);

const axesHelper = new THREE.AxesHelper(5);
scene.add(axesHelper);
const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
(scene as any).add(gridHelper);

// Raycast scratch state shared by click handler
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Voltage point visualizations — legacy path, migrated in Slice D.
const voltagePointMeshes: Map<string, THREE.Mesh> = new Map();
const voltagePointArrows: Map<string, THREE.Mesh[]> = new Map();
const voltagePointGeometry = new THREE.SphereGeometry(0.15, 12, 12);
const voltagePointMaterial = new THREE.MeshBasicMaterial({
  color: 0x00ff00,
  transparent: true,
  opacity: 0.8,
});
const voltageArrowGeometry = new THREE.ConeGeometry(0.05, 0.2, 8);
const voltageArrowMaterial = new THREE.MeshBasicMaterial({
  color: 0x4444ff,
  transparent: true,
  opacity: 0.8,
});

const updateVoltagePointMeshes = (
  voltagePoints: VoltagePoint[],
  sampleFieldAt: (position: THREE.Vector3) => { field: THREE.Vector3; potential: number },
) => {
  const seen: Set<string> = new Set();
  const upVector = new THREE.Vector3(0, 1, 0);
  const sphereRadius = 0.15;
  const arrowScale = 2.0;
  const maxFieldMagnitude = 1e4;

  const gridSize = 3;
  const gridStep = 0.4;
  const gridOffset = -(gridSize - 1) * gridStep / 2;

  for (const point of voltagePoints) {
    seen.add(point.id);
    let mesh = voltagePointMeshes.get(point.id);
    if (!mesh) {
      mesh = new THREE.Mesh(voltagePointGeometry, voltagePointMaterial);
      mesh.userData = { voltagePointId: point.id };
      scene.add(mesh);
      voltagePointMeshes.set(point.id, mesh);
    }
    mesh.position.copy(point.position);

    let arrows = voltagePointArrows.get(point.id);

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
          const arrowPos = point.position.clone().add(offset);
          const distance = offset.length();
          if (distance > sphereRadius && distance < sphereRadius + 0.6) {
            arrowPositions.push(arrowPos);
          }
        }
      }
    }

    if (arrows && arrows.length !== arrowPositions.length) {
      for (const arrow of arrows) {
        scene.remove(arrow);
        arrow.geometry.dispose();
        (arrow.material as THREE.Material).dispose();
      }
      arrows = undefined;
      voltagePointArrows.delete(point.id);
    }

    if (!arrows) {
      arrows = [];
      for (let i = 0; i < arrowPositions.length; i++) {
        const arrow = new THREE.Mesh(voltageArrowGeometry, voltageArrowMaterial);
        arrow.scale.set(1, 1, 1);
        scene.add(arrow);
        arrows.push(arrow);
      }
      voltagePointArrows.set(point.id, arrows);
    }

    for (let i = 0; i < arrowPositions.length && i < arrows.length; i++) {
      const arrow = arrows[i];
      const arrowPos = arrowPositions[i];
      const fieldResult = sampleFieldAt(arrowPos);
      const field = fieldResult.field;
      let arrowLength = field.length();

      if (field.length() < 1e-6) {
        arrow.scale.set(0, 0, 0);
        continue;
      }

      const normalizedMagnitude = Math.min(arrowLength / maxFieldMagnitude, 1);
      arrowLength = Math.max(normalizedMagnitude * arrowScale, 0.1);
      arrow.position.copy(arrowPos);
      const direction = field.clone().normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, direction);
      arrow.setRotationFromQuaternion(quaternion);
      arrow.scale.set(1, arrowLength, 1);
    }
  }

  for (const [id, mesh] of Array.from(voltagePointMeshes.entries())) {
    if (!seen.has(id)) {
      scene.remove(mesh);
      voltagePointMeshes.delete(id);

      const arrows = voltagePointArrows.get(id);
      if (arrows) {
        for (const arrow of arrows) {
          scene.remove(arrow);
          arrow.geometry.dispose();
          (arrow.material as THREE.Material).dispose();
        }
        voltagePointArrows.delete(id);
      }
    }
  }
};

function createInitialObjects(): SimObject[] {
  return [createDefaultPointCharge('charge-1')];
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  renderer.render(scene, camera);
}

const ThreeWorkspace: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [simulationMode, setSimulationMode] = useState<SimulationMode>('analytical');
  const [remoteServerUrl, setRemoteServerUrl] = useState('ws://localhost:8765/ws');
  const [simulationStats, setSimulationStats] = useState<SimulationStats>({
    mode: 'analytical',
    ready: true,
    usingFallback: false,
    paused: true,
    storageMode: '2d',
    targetStepsPerSecond: 0,
    steps: 0,
    stepsPerSecond: 0,
    dt: 0,
    sampleCacheSize: 0,
  });
  const [fdtdPaused, setFdtdPaused] = useState(true);
  const [fdtdTargetSps, setFdtdTargetSps] = useState(240);
  const simulationProviderRef = useRef<SimulationProvider>(
    createSimulationProvider('analytical'),
  );

  const sampleFieldAtPosition = useCallback((position: THREE.Vector3) => {
    return simulationProviderRef.current.sampleFieldAt(position);
  }, []);

  const samplePotentialAtPosition = useCallback((position: THREE.Vector3) => {
    return simulationProviderRef.current.samplePotentialAt(position);
  }, []);

  const [simulationTimeSeconds, setSimulationTimeSeconds] = useState(0);
  const [simulationClockRunning, setSimulationClockRunning] = useState(false);
  const [simulationTimeScale, setSimulationTimeScale] = useState(1);
  const simulationClockRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  // Unified SimObject state — single source of truth for everything placeable in the scene.
  const [objects, setObjects] = useState<SimObject[]>(createInitialObjects);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [objectStack, setObjectStack] = useState<string[]>([]);
  const objectsRef = useRef(objects);
  useEffect(() => { objectsRef.current = objects; }, [objects]);

  // Evaluated charges derived from objects each tick, consumed by SimulationProvider and
  // the view-layer renderers (VectorField, FieldLines). Separate from `objects` so
  // change-detection can skip resampling when DC sources haven't moved.
  const [chargesState, setChargesState] = useState<Charge[]>([]);
  const chargesRef = useRef<Charge[]>([]);
  useEffect(() => {
    chargesRef.current = chargesState;
    simulationProviderRef.current.setCharges(chargesState);
  }, [chargesState]);

  const [showVectorField, setShowVectorField] = useState(true);
  const [showFieldLines, setShowFieldLines] = useState(false);

  const vectorFieldRendererRef = useRef<VectorFieldRenderer | null>(null);
  const fieldLineRendererRef = useRef<FieldLineRenderer | null>(null);

  useEffect(() => {
    simulationProviderRef.current.dispose();
    simulationProviderRef.current = createSimulationProvider(simulationMode, remoteServerUrl);
    simulationProviderRef.current.setCharges(chargesRef.current);
    simulationProviderRef.current.setSimulationPaused(fdtdPaused);
    simulationProviderRef.current.setTargetStepsPerSecond(fdtdTargetSps);
    setSimulationStats(simulationProviderRef.current.getStats());

    vectorFieldRendererRef.current?.updateCharges(chargesRef.current);
    fieldLineRendererRef.current?.updateCharges(chargesRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationMode, remoteServerUrl]);

  // SimObject renderers — one instance per kind, created eagerly from the registry.
  // Each owns all meshes for objects of its kind; sync() diffs on every object/time/selection change.
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
  }, []);

  // Vector field renderer — owned by this effect (safe under React 18 StrictMode double-invoke)
  useEffect(() => {
    const vectorFieldConfig = createDefaultVectorFieldConfig();
    vectorFieldConfig.fieldSampler = (position, _c) => sampleFieldAtPosition(position);
    const vfRenderer = new VectorFieldRenderer(scene, vectorFieldConfig);
    vfRenderer.updateCharges(chargesRef.current);
    vectorFieldRendererRef.current = vfRenderer;
    return () => {
      vfRenderer.dispose();
      vectorFieldRendererRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Field line renderer — owned by this effect. 1 Hz refresh is co-located here so it's always
  // tied to the live renderer instance.
  useEffect(() => {
    const fieldLineConfig = createDefaultFieldLineConfig();
    fieldLineConfig.fieldSampler = (position, c) => electricFieldAt(position, c);
    const flRenderer = new FieldLineRenderer(scene, fieldLineConfig);
    flRenderer.updateCharges(chargesRef.current);
    flRenderer.setVisible(false);
    fieldLineRendererRef.current = flRenderer;
    const id = window.setInterval(() => {
      flRenderer.updateCharges(chargesRef.current);
    }, 1000);
    return () => {
      window.clearInterval(id);
      flRenderer.dispose();
      fieldLineRendererRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prevEvaluatedRef = useRef<Charge[]>([]);

  // Per-tick: evaluate each object's contribution, sync renderers, push changes downstream.
  useEffect(() => {
    const evaluated: Charge[] = [];
    for (const obj of objects) {
      const d = getDescriptor(obj.kind);
      const c = d?.evaluateCharge?.(obj, simulationTimeSeconds);
      if (c) evaluated.push(c);
    }

    // Only push updates downstream when charge values actually differ.
    // For DC sources this skips redundant React re-renders and vector field resampling
    // every animation frame even though nothing changed.
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
      r.sync(byKind.get(kind) ?? [], selectedObjectId, simulationTimeSeconds);
    }

    if (changed) {
      setChargesState(evaluated);
      vectorFieldRendererRef.current?.updateCharges(evaluated);
    }
  }, [objects, simulationTimeSeconds, selectedObjectId]);

  useEffect(() => {
    if (!simulationClockRunning) {
      if (simulationClockRef.current !== null) {
        cancelAnimationFrame(simulationClockRef.current);
        simulationClockRef.current = null;
      }
      lastFrameTimeRef.current = null;
      return;
    }

    const tick = (timestamp: number) => {
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = timestamp;
      }
      const dtSeconds = (timestamp - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = timestamp;
      setSimulationTimeSeconds((prev) => prev + dtSeconds * simulationTimeScale);
      simulationClockRef.current = requestAnimationFrame(tick);
    };

    simulationClockRef.current = requestAnimationFrame(tick);

    return () => {
      if (simulationClockRef.current !== null) {
        cancelAnimationFrame(simulationClockRef.current);
        simulationClockRef.current = null;
      }
    };
  }, [simulationClockRunning, simulationTimeScale]);

  const selectedObject = useMemo(
    () => (selectedObjectId ? objects.find((o) => o.id === selectedObjectId) ?? null : null),
    [objects, selectedObjectId],
  );
  const selectedPointCharge: PointChargeObject | null =
    selectedObject && selectedObject.kind === 'pointCharge' ? selectedObject : null;

  const [positionInputs, setPositionInputs] = useState({ x: '', y: '', z: '' });
  const prevSelectedIdRef = useRef<string | null>(null);
  const isEditingPositionRef = useRef(false);

  useEffect(() => {
    if (!selectedPointCharge) {
      prevSelectedIdRef.current = null;
      return;
    }
    if (!isEditingPositionRef.current && selectedPointCharge.id !== prevSelectedIdRef.current) {
      prevSelectedIdRef.current = selectedPointCharge.id;
      setPositionInputs({
        x: selectedPointCharge.position.x.toString(),
        y: selectedPointCharge.position.y.toString(),
        z: selectedPointCharge.position.z.toString(),
      });
    }
  }, [selectedPointCharge]);

  const [voltagePoints, setVoltagePoints] = useState<VoltagePoint[]>([]);
  const [showVoltagePointUI, setShowVoltagePointUI] = useState(false);
  const [newVoltagePoint, setNewVoltagePoint] = useState({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    if (voltagePoints.length === 0) return;
    const updated = voltagePoints.map((point) => ({
      ...point,
      voltage: samplePotentialAtPosition(point.position),
    }));
    setVoltagePoints(updated);
    updateVoltagePointMeshes(updated, sampleFieldAtPosition);
  }, [chargesState, sampleFieldAtPosition, samplePotentialAtPosition]);

  const [hoverVoltage, setHoverVoltage] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<THREE.Vector3 | null>(null);

  // --- SimObject CRUD ------------------------------------------------------
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

  const removeLastAdded = useCallback(() => {
    setObjectStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setObjects((os) => os.filter((o) => o.id !== last));
      setSelectedObjectId((cur) => (cur === last ? null : cur));
      return prev.slice(0, -1);
    });
  }, []);

  const removeAllCharges = useCallback(() => {
    setObjects((prev) => prev.filter((o) => o.kind !== 'pointCharge'));
    setObjectStack([]);
    setSelectedObjectId(null);
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

  const updatePointChargePosition = useCallback(
    (id: string, position: THREE.Vector3) => {
      setObjects((prev) => prev.map((o) => {
        if (o.id !== id || o.kind !== 'pointCharge') return o;
        return { ...o, position: position.clone() };
      }));
    },
    [],
  );

  // --- Voltage point management (legacy path) ------------------------------
  const addVoltagePoint = useCallback(() => {
    const position = new THREE.Vector3(
      newVoltagePoint.x,
      newVoltagePoint.y,
      newVoltagePoint.z,
    );
    const newPoint = createVoltagePoint(position, samplePotentialAtPosition(position));
    const updated = [...voltagePoints, newPoint];
    setVoltagePoints(updated);
    updateVoltagePointMeshes(updated, sampleFieldAtPosition);
    setShowVoltagePointUI(false);
  }, [newVoltagePoint, sampleFieldAtPosition, samplePotentialAtPosition, voltagePoints]);

  const removeVoltagePoint = useCallback(
    (pointId: string) => {
      const newPoints = voltagePoints.filter((point) => point.id !== pointId);
      setVoltagePoints(newPoints);
      updateVoltagePointMeshes(newPoints, sampleFieldAtPosition);
    },
    [sampleFieldAtPosition, voltagePoints],
  );

  const removeAllVoltagePoints = useCallback(() => {
    setVoltagePoints([]);
    updateVoltagePointMeshes([], sampleFieldAtPosition);
  }, [sampleFieldAtPosition]);

  const handleMouseClick = useCallback((event: MouseEvent) => {
    if (!controls) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const selectable: THREE.Object3D[] = [];
    for (const r of renderersRef.current.values()) {
      selectable.push(...r.getSelectableMeshes());
    }
    const objectHits = raycaster.intersectObjects(selectable);
    const voltageHits = raycaster.intersectObjects(
      Array.from(voltagePointMeshes.values()),
    );

    if (objectHits.length > 0) {
      const clickedId = objectHits[0].object.userData.simObjectId as string | undefined;
      if (clickedId) setSelectedObjectId(clickedId);
    } else if (voltageHits.length > 0) {
      console.log(
        'Voltage point clicked:',
        voltageHits[0].object.userData.voltagePointId,
      );
    } else {
      setShowVoltagePointUI(true);
      setSelectedObjectId(null);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!container.contains(renderer.domElement)) {
      container.appendChild(renderer.domElement);
    }

    camera.position.set(8, 8, 8);
    camera.lookAt(0, 0, 0);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const onResize = () => {
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    onResize();
    window.addEventListener('resize', onResize);
    renderer.domElement.addEventListener('click', handleMouseClick);

    const moveRaycaster = new THREE.Raycaster();
    const moveMouse = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const onMouseMove = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      moveMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      moveMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      moveRaycaster.setFromCamera(moveMouse, camera);
      const intersectionPoint = new THREE.Vector3();
      const result = moveRaycaster.ray.intersectPlane(plane, intersectionPoint);

      if (result !== null) {
        const pos = intersectionPoint.clone();
        setHoverPosition(pos);
        setHoverVoltage(samplePotentialAtPosition(pos));
      } else {
        setHoverPosition(null);
        setHoverVoltage(null);
      }
    };

    renderer.domElement.addEventListener('mousemove', onMouseMove);

    animate();

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('click', handleMouseClick);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [handleMouseClick, sampleFieldAtPosition, samplePotentialAtPosition]);

  useEffect(() => {
    updateVoltagePointMeshes(voltagePoints, sampleFieldAtPosition);
  }, [sampleFieldAtPosition, voltagePoints]);

  useEffect(() => {
    return () => {
      simulationProviderRef.current.dispose();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSimulationStats(simulationProviderRef.current.getStats());
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      simulationProviderRef.current.invalidateFieldCache();
      vectorFieldRendererRef.current?.updateCharges(chargesRef.current);
    }, 300);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    simulationProviderRef.current.setSimulationPaused(fdtdPaused);
  }, [fdtdPaused, simulationMode]);

  useEffect(() => {
    simulationProviderRef.current.setTargetStepsPerSecond(fdtdTargetSps);
  }, [fdtdTargetSps, simulationMode]);

  const toggleVectorField = () => {
    const newVisibility = !showVectorField;
    setShowVectorField(newVisibility);
    vectorFieldRendererRef.current?.setVisible(newVisibility);
  };

  const toggleFieldLines = () => {
    const newVisibility = !showFieldLines;
    setShowFieldLines(newVisibility);
    fieldLineRendererRef.current?.setVisible(newVisibility);
  };

  const pointCharges = objects.filter((o): o is PointChargeObject => o.kind === 'pointCharge');

  // Evaluated magnitude of the selected point charge — preserves legacy inspector behavior
  // of showing instantaneous value (matches offset for DC, varies with time for sine/pulse).
  const selectedEvaluatedMagnitude = selectedPointCharge
    ? evaluateWaveform(selectedPointCharge.waveform, simulationTimeSeconds)
    : 0;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', background: '#282c34' }}
      />

      {/* Control panel - top left */}
      <div
        style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '15px',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '12px',
          minWidth: '260px',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
          Electric Field Visualizer
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>Simulation Mode:</label>
          <select
            value={simulationMode}
            onChange={(e) => setSimulationMode(e.target.value as SimulationMode)}
            style={{
              width: '100%',
              padding: '6px',
              borderRadius: '3px',
              border: '1px solid #555',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              fontSize: '11px',
            }}
          >
            <option value="analytical" style={{ color: '#111' }}>Analytical</option>
            <option value="fdtd" style={{ color: '#111' }}>FDTD (WIP)</option>
            <option value="remote" style={{ color: '#111' }}>Remote FDTD</option>
          </select>
        </div>

        {simulationMode === 'remote' && (
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>Remote Server URL:</label>
            <input
              type="text"
              value={remoteServerUrl}
              onChange={(e) => setRemoteServerUrl(e.target.value)}
              placeholder="ws://localhost:8765/ws"
              style={{
                width: '100%',
                padding: '6px',
                borderRadius: '3px',
                border: `1px solid ${simulationStats.ready ? '#4c4' : '#c44'}`,
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                fontSize: '10px',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: '10px', marginTop: '3px', color: simulationStats.ready ? '#4c4' : '#f88' }}>
              {simulationStats.ready ? 'Connected' : 'Disconnected — check server URL'}
            </div>
          </div>
        )}

        <div
          style={{
            marginBottom: '10px',
            padding: '6px',
            borderRadius: '4px',
            background: 'rgba(255,255,255,0.08)',
            fontSize: '10px',
          }}
        >
          <div>Status: {simulationStats.ready ? 'ready' : 'initializing'}</div>
          <div>Fallback: {simulationStats.usingFallback ? 'yes' : 'no'}</div>
          <div>Paused: {simulationStats.paused ? 'yes' : 'no'}</div>
          <div>Storage: {simulationStats.storageMode}</div>
          <div>Target SPS: {simulationStats.targetStepsPerSecond}</div>
          <div>Steps: {simulationStats.steps}</div>
          <div>Steps/sec: {simulationStats.stepsPerSecond.toFixed(1)}</div>
          <div>dt: {simulationStats.dt.toExponential(3)} s</div>
          <div>Cache: {simulationStats.sampleCacheSize}</div>
        </div>

        <div
          style={{
            marginBottom: '10px',
            padding: '8px',
            borderRadius: '4px',
            background: 'rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ fontSize: '11px', marginBottom: '6px' }}>Simulation Clock</div>
          <div style={{ fontSize: '10px', marginBottom: '6px' }}>
            t = {simulationTimeSeconds.toFixed(4)} s
          </div>
          <button
            onClick={() => setSimulationClockRunning((prev) => !prev)}
            style={{
              width: '100%',
              padding: '6px',
              marginBottom: '6px',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'white',
              background: simulationClockRunning ? '#f57c00' : '#4CAF50',
              fontSize: '11px',
            }}
          >
            {simulationClockRunning ? 'Pause Time' : 'Run Time'}
          </button>
          <button
            onClick={() => setSimulationTimeSeconds((prev) => prev + (1 / 120) * simulationTimeScale)}
            style={{
              width: '100%',
              padding: '6px',
              marginBottom: '6px',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'white',
              background: '#546E7A',
              fontSize: '11px',
            }}
          >
            Step +dt
          </button>
          <label style={{ display: 'block', fontSize: '10px', marginBottom: '4px' }}>
            Time Scale: {simulationTimeScale.toFixed(2)}x
          </label>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={simulationTimeScale}
            onChange={(e) => setSimulationTimeScale(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        {simulationMode === 'fdtd' && (
          <div
            style={{
              marginBottom: '10px',
              padding: '8px',
              borderRadius: '4px',
              background: 'rgba(33,150,243,0.12)',
              border: '1px solid rgba(33,150,243,0.35)',
            }}
          >
            <button
              onClick={() => setFdtdPaused((prev) => !prev)}
              style={{
                width: '100%',
                padding: '6px',
                marginBottom: '8px',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                color: 'white',
                background: fdtdPaused ? '#4CAF50' : '#f57c00',
                fontSize: '11px',
              }}
            >
              {fdtdPaused ? 'Resume Simulation' : 'Pause Simulation'}
            </button>

            <label style={{ display: 'block', fontSize: '10px', marginBottom: '4px' }}>
              Target Steps/sec: {fdtdTargetSps}
            </label>
            <input
              type="range"
              min={30}
              max={1000}
              step={10}
              value={fdtdTargetSps}
              onChange={(e) => setFdtdTargetSps(parseInt(e.target.value, 10))}
              style={{ width: '100%' }}
            />
          </div>
        )}

        <div style={{ marginBottom: '8px' }}>
          <div>Charges: {chargesState.length}</div>
          <div>Sources: {pointCharges.length}</div>
          <div style={{ fontSize: '10px', color: '#ccc' }}>
            Click charges to select, click empty space to add a voltage point
          </div>
        </div>

        {hoverVoltage !== null && hoverPosition && (
          <div
            style={{
              marginBottom: '10px',
              padding: '6px',
              background: 'rgba(255, 255, 255, 0.08)',
              borderRadius: '4px',
              fontSize: '11px',
            }}
          >
            <div>Voltage at cursor: {hoverVoltage.toExponential(2)} V</div>
            <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px' }}>
              ({hoverPosition.x.toFixed(2)}, {hoverPosition.y.toFixed(2)},{' '}
              {hoverPosition.z.toFixed(2)})
            </div>
          </div>
        )}

        <div style={{ marginBottom: '10px' }}>
          <button
            onClick={addPointCharge}
            style={{
              padding: '8px 12px',
              background: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginRight: '5px',
              fontSize: '11px',
            }}
          >
            + Add Source
          </button>

          {objectStack.length > 0 && (
            <button
              onClick={removeLastAdded}
              style={{
                padding: '8px 12px',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                marginRight: '5px',
                fontSize: '11px',
              }}
            >
              - Remove Last
            </button>
          )}

          {pointCharges.length > 0 && (
            <button
              onClick={removeAllCharges}
              style={{
                padding: '8px 12px',
                background: '#ff6b6b',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
              }}
            >
              🗑 Remove All
            </button>
          )}
        </div>

        <div style={{ marginBottom: '10px' }}>
          <button
            onClick={toggleVectorField}
            style={{
              padding: '8px 12px',
              background: showVectorField ? '#4CAF50' : '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              width: '100%',
              marginBottom: '5px',
            }}
          >
            {showVectorField ? 'Hide' : 'Show'} Vector Field
          </button>
          <button
            onClick={toggleFieldLines}
            style={{
              padding: '8px 12px',
              background: showFieldLines ? '#4CAF50' : '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              width: '100%',
            }}
          >
            {showFieldLines ? 'Hide' : 'Show'} Field Lines
          </button>
        </div>

        <button
          onClick={() => {
            setNewVoltagePoint({ x: 0, y: 0, z: 0 });
            setShowVoltagePointUI(true);
          }}
          style={{
            padding: '8px 12px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '10px',
            fontSize: '11px',
            width: '100%',
          }}
        >
          Add Voltage Measurement (by coordinates)
        </button>

        {selectedPointCharge && (
          <div
            style={{
              border: '1px solid #555',
              padding: '10px',
              borderRadius: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
              Selected Charge: {selectedPointCharge.id}
            </div>

            <div style={{ marginBottom: '5px' }}>
              <label style={{ display: 'block', marginBottom: '2px' }}>Source Type:</label>
              <select
                value={selectedPointCharge.waveform.type}
                onChange={(e) => updatePointChargeWaveform(selectedPointCharge.id, 'type', e.target.value as SourceWaveformType)}
                style={{
                  width: '100%',
                  padding: '4px',
                  borderRadius: '3px',
                  border: '1px solid #555',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontSize: '11px',
                }}
              >
                <option value="dc" style={{ color: '#111' }}>DC</option>
                <option value="sine" style={{ color: '#111' }}>Sine</option>
                <option value="pulse" style={{ color: '#111' }}>Pulse</option>
              </select>
            </div>

            <div style={{ marginBottom: '5px' }}>
              <label style={{ display: 'block', marginBottom: '2px' }}>
                Magnitude (μC):
              </label>
              <input
                type="number"
                value={(selectedEvaluatedMagnitude * 1e6).toFixed(2)}
                onChange={(e) => {
                  const newMagnitude = parseFloat(e.target.value) * 1e-6;
                  updatePointChargeWaveform(selectedPointCharge.id, 'offset', newMagnitude);
                }}
                style={{
                  width: '100%',
                  padding: '4px',
                  borderRadius: '3px',
                  border: '1px solid #555',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontSize: '11px',
                }}
              />
            </div>

            {selectedPointCharge.waveform.type !== 'dc' && (
              <>
                <div style={{ marginBottom: '5px' }}>
                  <label style={{ display: 'block', marginBottom: '2px' }}>
                    Amplitude (μC):
                  </label>
                  <input
                    type="number"
                    value={(selectedPointCharge.waveform.amplitude * 1e6).toFixed(2)}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isNaN(v)) {
                        updatePointChargeWaveform(selectedPointCharge.id, 'amplitude', v * 1e-6);
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '4px',
                      borderRadius: '3px',
                      border: '1px solid #555',
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: 'white',
                      fontSize: '11px',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '5px' }}>
                  <label style={{ display: 'block', marginBottom: '2px' }}>
                    Frequency (Hz):
                  </label>
                  <input
                    type="number"
                    value={selectedPointCharge.waveform.frequencyHz}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isNaN(v)) {
                        updatePointChargeWaveform(selectedPointCharge.id, 'frequencyHz', Math.max(0.001, v));
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '4px',
                      borderRadius: '3px',
                      border: '1px solid #555',
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: 'white',
                      fontSize: '11px',
                    }}
                  />
                </div>
              </>
            )}

            {selectedPointCharge.waveform.type === 'pulse' && (
              <div style={{ marginBottom: '5px' }}>
                <label style={{ display: 'block', marginBottom: '2px' }}>
                  Duty Cycle:
                </label>
                <input
                  type="range"
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  value={selectedPointCharge.waveform.dutyCycle}
                  onChange={(e) => {
                    updatePointChargeWaveform(selectedPointCharge.id, 'dutyCycle', parseFloat(e.target.value));
                  }}
                  style={{ width: '100%' }}
                />
              </div>
            )}

            <div style={{ marginBottom: '5px' }}>
              <label style={{ display: 'block', marginBottom: '2px' }}>Position X:</label>
              <input
                type="text"
                value={positionInputs.x}
                onFocus={() => { isEditingPositionRef.current = true; }}
                onBlur={() => { isEditingPositionRef.current = false; }}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                    setPositionInputs({ ...positionInputs, x: val });
                    const numVal = parseFloat(val);
                    if (!isNaN(numVal)) {
                      const newPos = selectedPointCharge.position.clone();
                      newPos.x = numVal;
                      updatePointChargePosition(selectedPointCharge.id, newPos);
                    }
                  }
                }}
                style={{
                  width: '100%',
                  padding: '4px',
                  borderRadius: '3px',
                  border: '1px solid #555',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontSize: '11px',
                }}
              />
            </div>

            <div style={{ marginBottom: '5px' }}>
              <label style={{ display: 'block', marginBottom: '2px' }}>Position Y:</label>
              <input
                type="text"
                value={positionInputs.y}
                onFocus={() => { isEditingPositionRef.current = true; }}
                onBlur={() => { isEditingPositionRef.current = false; }}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                    setPositionInputs({ ...positionInputs, y: val });
                    const numVal = parseFloat(val);
                    if (!isNaN(numVal)) {
                      const newPos = selectedPointCharge.position.clone();
                      newPos.y = numVal;
                      updatePointChargePosition(selectedPointCharge.id, newPos);
                    }
                  }
                }}
                style={{
                  width: '100%',
                  padding: '4px',
                  borderRadius: '3px',
                  border: '1px solid #555',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontSize: '11px',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '2px' }}>Position Z:</label>
              <input
                type="text"
                value={positionInputs.z}
                onFocus={() => { isEditingPositionRef.current = true; }}
                onBlur={() => { isEditingPositionRef.current = false; }}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                    setPositionInputs({ ...positionInputs, z: val });
                    const numVal = parseFloat(val);
                    if (!isNaN(numVal)) {
                      const newPos = selectedPointCharge.position.clone();
                      newPos.z = numVal;
                      updatePointChargePosition(selectedPointCharge.id, newPos);
                    }
                  }
                }}
                style={{
                  width: '100%',
                  padding: '4px',
                  borderRadius: '3px',
                  border: '1px solid #555',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontSize: '11px',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Voltage point coordinate dialog - top right */}
      {showVoltagePointUI && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: 'rgba(0, 0, 0, 0.9)',
            color: 'white',
            padding: '20px',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '12px',
            zIndex: 1000,
            minWidth: '280px',
            border: '2px solid #444',
          }}
        >
          <div
            style={{
              marginBottom: '12px',
              fontWeight: 'bold',
              fontSize: '14px',
            }}
          >
            Add Voltage Measurement Point
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>X:</label>
            <input
              type="number"
              value={newVoltagePoint.x}
              onChange={(e) =>
                setNewVoltagePoint((prev) => ({
                  ...prev,
                  x: parseFloat(e.target.value) || 0,
                }))
              }
              style={{
                width: '100%',
                padding: '5px',
                background: '#333',
                color: 'white',
                border: '1px solid #555',
                borderRadius: '3px',
                fontSize: '12px',
              }}
            />
          </div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>Y:</label>
            <input
              type="number"
              value={newVoltagePoint.y}
              onChange={(e) =>
                setNewVoltagePoint((prev) => ({
                  ...prev,
                  y: parseFloat(e.target.value) || 0,
                }))
              }
              style={{
                width: '100%',
                padding: '5px',
                background: '#333',
                color: 'white',
                border: '1px solid #555',
                borderRadius: '3px',
                fontSize: '12px',
              }}
            />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>Z:</label>
            <input
              type="number"
              value={newVoltagePoint.z}
              onChange={(e) =>
                setNewVoltagePoint((prev) => ({
                  ...prev,
                  z: parseFloat(e.target.value) || 0,
                }))
              }
              style={{
                width: '100%',
                padding: '5px',
                background: '#333',
                color: 'white',
                border: '1px solid #555',
                borderRadius: '3px',
                fontSize: '12px',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={addVoltagePoint}
              style={{
                flex: 1,
                padding: '8px',
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Measure Voltage
            </button>
            <button
              onClick={() => setShowVoltagePointUI(false)}
              style={{
                flex: 1,
                padding: '8px',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Voltage points list - bottom right */}
      {voltagePoints.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            right: '10px',
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '15px',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '12px',
            minWidth: '300px',
            maxHeight: '300px',
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
            Voltage Points ({voltagePoints.length})
          </div>

          {voltagePoints.map((point, index) => (
            <div
              key={point.id}
              style={{
                border: '1px solid #555',
                padding: '8px',
                marginBottom: '5px',
                borderRadius: '4px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
              }}
            >
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                Point {index + 1}
              </div>
              <div style={{ fontSize: '10px', marginBottom: '2px' }}>
                Position: ({point.position.x.toFixed(2)}, {point.position.y.toFixed(2)},{' '}
                {point.position.z.toFixed(2)})
              </div>
              <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                Voltage: {point.voltage.toExponential(2)} V
              </div>
              <button
                onClick={() => removeVoltagePoint(point.id)}
                style={{
                  padding: '4px 8px',
                  background: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '10px',
                }}
              >
                Remove
              </button>
            </div>
          ))}

          {voltagePoints.length > 0 && (
            <button
              onClick={removeAllVoltagePoints}
              style={{
                padding: '8px 12px',
                background: '#ff6b6b',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                width: '100%',
                marginTop: '10px',
              }}
            >
              🗑 Remove All
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ThreeWorkspace;
