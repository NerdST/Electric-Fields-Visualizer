import React, { useRef, useEffect, useState, useCallback } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createDefaultCharge, createCharge, electricFieldAt } from '../models/Charge';
import type { Charge } from '../models/Charge';
import { VectorFieldRenderer, createDefaultVectorFieldConfig } from '../views/VectorField';
import { FieldLineRenderer, createDefaultFieldLineConfig } from '../views/FieldLines';
import { createVoltagePoint } from '../models/VoltagePoint';
import type { VoltagePoint } from '../models/VoltagePoint';
import { computeTwoPointProbe } from '../models/TwoPointProbe';
import type { TwoPointProbeResult } from '../models/TwoPointProbe';
import { computeLineProbe } from '../models/LineProbe';
import type { LineProbeResult } from '../models/LineProbe';
import { FDTDSimulation3D, createDefaultFDTDConfig } from '../simulation/FDTDSimulation3D';
import { FDTDSimulationGPU } from '../simulation/FDTDSimulationGPU';
import { FDTDVectorFieldRenderer } from '../views/FDTDVectorField';
import type { FDTDSimulationReader } from '../views/FDTDVectorField';
import { FDTDHeatmapRenderer } from '../views/FDTDHeatmap';

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

// Charge/voltage geometries & materials
const chargeGeometry = new THREE.SphereGeometry(0.2, 16, 16);
const positiveChargeMaterial = new THREE.MeshStandardMaterial({ color: 0xff4444 });
const negativeChargeMaterial = new THREE.MeshStandardMaterial({ color: 0x4444ff });


// Add some default charges
const charge1 = createDefaultCharge('charge-1');
charge1.position.set(0, 0, 0);
charge1.magnitude = 1e-6;

let charges: Charge[] = [charge1];

// Create charge visualizations
let chargeMeshes: Map<string, THREE.Mesh> = new Map();
let selectedChargeId: string | null = null;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();

// Voltage point visualizations
let voltagePointMeshes: Map<string, THREE.Mesh> = new Map();
let voltagePointArrows: Map<string, THREE.Mesh[]> = new Map();
const voltagePointGeometry = new THREE.SphereGeometry(0.15, 12, 12);
const voltagePointMaterial = new THREE.MeshBasicMaterial({
  color: 0x00ff00,
  transparent: true,
  opacity: 0.8,
});

// Arrow geometry for voltage points (same size as field arrows)
const voltageArrowGeometry = new THREE.ConeGeometry(0.05, 0.2, 8);
const voltageArrowMaterial = new THREE.MeshBasicMaterial({
  color: 0x4444ff, // Blue color
  transparent: true,
  opacity: 0.8,
});

const updateChargeMeshes = () => {
  const seen: Set<string> = new Set();

  for (const charge of charges) {
    seen.add(charge.id);
    let mesh = chargeMeshes.get(charge.id);
    const desiredMaterial =
      charge.magnitude > 0 ? positiveChargeMaterial : negativeChargeMaterial;
    if (!mesh) {
      mesh = new THREE.Mesh(chargeGeometry, desiredMaterial);
  mesh.userData = { chargeId: charge.id };
  scene.add(mesh);
      chargeMeshes.set(charge.id, mesh);
    } else {
      const isPositive = mesh.material === positiveChargeMaterial;
      if ((isPositive && charge.magnitude < 0) || (!isPositive && charge.magnitude > 0)) {
        mesh.material = desiredMaterial;
      }
    }
    mesh.position.copy(charge.position);

    // Selection highlight
    mesh.scale.setScalar(selectedChargeId === charge.id ? 1.5 : 1.0);
    mesh.children
      .filter((c) => (c as any).isMesh)
      .forEach((child) => mesh && mesh.remove(child));
    if (selectedChargeId === charge.id) {
      const outlineGeometry = new THREE.SphereGeometry(0.25, 16, 16);
      const outlineMaterial = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        wireframe: true,
        transparent: true,
        opacity: 0.8,
      });
      const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
      mesh.add(outline);
    }
  }

  for (const [id, mesh] of Array.from(chargeMeshes.entries())) {
    if (!seen.has(id)) {
      scene.remove(mesh);
      chargeMeshes.delete(id);
    }
  }
};

// Function to update voltage point meshes
const updateVoltagePointMeshes = (voltagePoints: VoltagePoint[]) => {
  const seen: Set<string> = new Set();
  const upVector = new THREE.Vector3(0, 1, 0);
  const sphereRadius = 0.15;
  const arrowScale = 2.0; 
  const maxFieldMagnitude = 1e4;

  // Generate points around each voltage orb in a small grid
  const gridSize = 3; // 3x3x3 grid around each orb
  const gridStep = 0.4; // Distance between grid points
  const gridOffset = -(gridSize - 1) * gridStep / 2;

  // Update existing and create missing
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

    // Create or update arrows for this voltage point
    let arrows = voltagePointArrows.get(point.id);
    
    // Calculate positions for arrows around the orb
    const arrowPositions: THREE.Vector3[] = [];
    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        for (let z = 0; z < gridSize; z++) {
          // Skip the center position (where the orb is)
          if (x === 1 && y === 1 && z === 1) continue;
          
          const offset = new THREE.Vector3(
            gridOffset + x * gridStep,
            gridOffset + y * gridStep,
            gridOffset + z * gridStep
          );
          const arrowPos = point.position.clone().add(offset);
          
          // Only add arrows that are at a reasonable distance from the orb
          const distance = offset.length();
          if (distance > sphereRadius && distance < sphereRadius + 0.6) {
            arrowPositions.push(arrowPos);
          }
        }
      }
    }

    // Remove old arrows if count changed
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

    // Update arrow positions and orientations based on electric field
    for (let i = 0; i < arrowPositions.length && i < arrows.length; i++) {
      const arrow = arrows[i];
      const arrowPos = arrowPositions[i];
      
      // Calculate electric field at this position
      const fieldResult = electricFieldAt(arrowPos, charges);
      const field = fieldResult.field;
      
      let arrowLength = field.length();
      
      if (field.length() < 1e-6) {
        // Hide arrow if field is too small
        arrow.scale.set(0, 0, 0);
        continue;
      }

      const normalizedMagnitude = Math.min(arrowLength / maxFieldMagnitude, 1);
      arrowLength = Math.max(normalizedMagnitude * arrowScale, 0.1);

      // Position arrow at the grid position (same as vector field)
      arrow.position.copy(arrowPos);
      
      // Orient arrow in field direction
      const direction = field.clone().normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, direction);
      arrow.setRotationFromQuaternion(quaternion);
      
      // Scale arrow (length along Y axis) - exactly like vector field
      arrow.scale.set(1, arrowLength, 1);
    }
  }

  // Remove meshes and arrows that no longer have voltage points
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

// Initialize charge meshes
updateChargeMeshes();

// FDTD simulation (module-level so it persists across React re-renders)
// Starts with CPU version; GPU version replaces it once initialized.
const fdtdConfig = createDefaultFDTDConfig();
type FDTDSim = FDTDSimulationReader & {
  step: () => void;
  reset: () => void;
  addSource: (s: any) => void;
  clearSources: () => void;
  clearSourceField: () => void;
  injectImpulse: (ix: number, iy: number, iz: number, amplitude: number) => void;
  getStepCount: () => number;
  getCurrentTime: () => number;
  readback?: () => Promise<void>;
};
let fdtdSimulation: FDTDSim = new FDTDSimulation3D(fdtdConfig);
let fdtdHeatmap: FDTDHeatmapRenderer = new FDTDHeatmapRenderer(scene, fdtdSimulation);
let fdtdIsGPU = false;

/** Convert a world-space position to FDTD grid indices */
function worldToGrid(pos: THREE.Vector3): { ix: number; iy: number; iz: number } | null {
  const ws = fdtdIsGPU ? 0.15 : 0.3; // worldScale used by heatmap
  const ox = -(fdtdConfig.nx * ws) / 2;
  const oy = -(fdtdConfig.ny * ws) / 2;
  const oz = -(fdtdConfig.nz * ws) / 2;

  const ix = Math.round((pos.x - ox) / ws);
  const iy = Math.round((pos.y - oy) / ws);
  const iz = Math.round((pos.z - oz) / ws);

  // Clamp to interior (avoid boundary cells)
  if (ix < 2 || ix >= fdtdConfig.nx - 2) return null;
  if (iy < 2 || iy >= fdtdConfig.ny - 2) return null;
  if (iz < 2 || iz >= fdtdConfig.nz - 2) return null;

  return { ix, iy, iz };
}

/**
 * Reset the FDTD simulation and inject all charges into the persistent
 * source field. Each charge continuously pumps energy into E each timestep
 * (E += dt * source), creating expanding wavefronts — like Sangeeth's 2D version.
 */
function injectChargesIntoFDTD(currentCharges: Charge[]) {
  fdtdSimulation.reset();
  fdtdHeatmap.resetPeak();

  for (const charge of currentCharges) {
    const grid = worldToGrid(charge.position);
    if (!grid) continue;

    // Inject into persistent source field — will pump E every step
    const amplitude = charge.magnitude > 0 ? 1.0 : -1.0;
    fdtdSimulation.injectImpulse(grid.ix, grid.iy, grid.iz, amplitude);
  }
}

// Try to initialize GPU simulation — fall back to CPU if unavailable
(async () => {
  if (!('gpu' in navigator)) {
    console.log('FDTD: WebGPU not available, using CPU simulation');
    return;
  }
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) {
      console.log('FDTD: No GPU adapter, using CPU simulation');
      return;
    }
    const device: GPUDevice = await adapter.requestDevice();
    const gpuSim = await FDTDSimulationGPU.create(device, fdtdConfig);

    // Swap in GPU simulation
    fdtdSimulation = gpuSim as unknown as FDTDSim;
    fdtdIsGPU = true;

    // Rebuild heatmap with the new simulation reference
    fdtdHeatmap.dispose();
    fdtdHeatmap = new FDTDHeatmapRenderer(scene, fdtdSimulation, 0.15, 3);
    fdtdHeatmap.setVisible(true);

    // Re-inject charges into the new GPU simulation
    injectChargesIntoFDTD(charges);

    console.log(`FDTD: GPU simulation active (${fdtdConfig.nx}³ grid)`);
  } catch (err) {
    console.warn('FDTD: GPU init failed, using CPU simulation', err);
  }
})();

// FDTD is always running — it's the core physics engine
let fdtdRunning = true;
let fdtdStepsPerFrame = 5;
let pendingReadback = false;

// Start heatmap visible and inject initial charges
fdtdHeatmap.setVisible(true);
injectChargesIntoFDTD(charges);

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();

  // FDTD is the core physics engine — always stepping
  if (fdtdRunning) {
    for (let i = 0; i < fdtdStepsPerFrame; i++) {
      fdtdSimulation.step();
    }

    if (fdtdIsGPU && fdtdSimulation.readback && !pendingReadback) {
      pendingReadback = true;
      fdtdSimulation.readback().then(() => {
        fdtdHeatmap.update();
        pendingReadback = false;
      });
    } else if (!fdtdIsGPU) {
      fdtdHeatmap.update();
    }
  }

  renderer.render(scene, camera);
}

const ThreeWorkspace: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vectorFieldRenderer, setVectorFieldRenderer] =
    useState<VectorFieldRenderer | null>(null);
  const [showVectorField, setShowVectorField] = useState(false);
  const [fieldLineRenderer, setFieldLineRenderer] =
    useState<FieldLineRenderer | null>(null);
  const [showFieldLines, setShowFieldLines] = useState(false);

  // Charge state mirrors global `charges`
  const [chargesState, setChargesState] = useState<Charge[]>(charges);
  const chargesRef = useRef<Charge[]>(chargesState);
  useEffect(() => {
    chargesRef.current = chargesState;
  }, [chargesState]);

  const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);
  const [chargeStack, setChargeStack] = useState<string[]>([]);
  const [positionInputs, setPositionInputs] = useState({ x: '', y: '', z: '' });
  const selectedChargeIdRef = useRef<string | null>(null);
  const isEditingPositionRef = useRef(false);
  
  useEffect(() => {
    if (!isEditingPositionRef.current && selectedCharge && selectedCharge.id !== selectedChargeIdRef.current) {
      selectedChargeIdRef.current = selectedCharge.id;
      setPositionInputs({
        x: selectedCharge.position.x.toString(),
        y: selectedCharge.position.y.toString(),
        z: selectedCharge.position.z.toString(),
      });
    } else if (!selectedCharge) {
      selectedChargeIdRef.current = null;
    }
  }, [selectedCharge?.id]);
  
  useEffect(() => {
    if (selectedCharge && !isEditingPositionRef.current) {
      const currentCharge = chargesState.find(c => c.id === selectedCharge.id);
      if (currentCharge && currentCharge.id === selectedChargeIdRef.current) {
        setSelectedCharge(currentCharge);
      }
    }
  }, [chargesState, selectedCharge?.id]);

  // Voltage measurement points (computed via electricFieldAt)
  const [voltagePoints, setVoltagePoints] = useState<VoltagePoint[]>([]);
  const [showVoltagePointUI, setShowVoltagePointUI] = useState(false);
  const [newVoltagePoint, setNewVoltagePoint] = useState({
    x: 0,
    y: 0,
    z: 0,
  });

  // Pin probe: recalculate voltage at all measurement points when charges change
  useEffect(() => {
    if (voltagePoints.length === 0) return;
    const updated = voltagePoints.map((point) => {
      const fieldResult = electricFieldAt(point.position, chargesState);
      return { ...point, voltage: fieldResult.potential };
    });
    setVoltagePoints(updated);
    updateVoltagePointMeshes(updated);
  }, [chargesState]);

  const [hoverVoltage, setHoverVoltage] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<THREE.Vector3 | null>(null);

  const [probeMode, setProbeMode] = useState(false);
  const [probePointA, setProbePointA] = useState<THREE.Vector3 | null>(null);
  const [probeResult, setProbeResult] = useState<TwoPointProbeResult | null>(null);
  const probeModeRef = useRef(false);
  const probePointARef = useRef<THREE.Vector3 | null>(null);

  // Coordinate inputs for two-point probe
  const [probeInputA, setProbeInputA] = useState({ x: '0', y: '0', z: '0' });
  const [probeInputB, setProbeInputB] = useState({ x: '1', y: '0', z: '0' });

  // Coordinate input for line probe waypoint entry
  const [lineProbeInput, setLineProbeInput] = useState({ x: '0', y: '0', z: '0' });

  useEffect(() => {
    probeModeRef.current = probeMode;
  }, [probeMode]);
  useEffect(() => {
    probePointARef.current = probePointA;
  }, [probePointA]);

  // Need it to recalculate probe result when charges change
  useEffect(() => {
    if (probeResult) {
      const updated = computeTwoPointProbe(probeResult.pointA, probeResult.pointB, chargesState);
      setProbeResult(updated);
    }
  }, [chargesState]);

  // Line probe state
  const [lineProbeMode, setLineProbeMode] = useState(false);
  const [lineProbeWaypoints, setLineProbeWaypoints] = useState<THREE.Vector3[]>([]);
  const [lineProbeResult, setLineProbeResult] = useState<LineProbeResult | null>(null);
  const lineProbeModeRef = useRef(false);
  const lineProbeWaypointsRef = useRef<THREE.Vector3[]>([]);

  useEffect(() => {
    lineProbeModeRef.current = lineProbeMode;
  }, [lineProbeMode]);
  useEffect(() => {
    lineProbeWaypointsRef.current = lineProbeWaypoints;
  }, [lineProbeWaypoints]);

  useEffect(() => {
    if (lineProbeResult && lineProbeResult.waypoints.length >= 2) {
      const updated = computeLineProbe(lineProbeResult.waypoints, chargesState);
      setLineProbeResult(updated);
    }
  }, [chargesState]);

  const finishLinePath = useCallback(() => {
    const waypoints = lineProbeWaypointsRef.current;
    if (waypoints.length >= 2) {
      const result = computeLineProbe(waypoints, chargesRef.current);
      setLineProbeResult(result);
    }
    setLineProbeMode(false);
    setLineProbeWaypoints([]);
  }, []);

  const vectorFieldInitialized = useRef(false);
  const fieldLineInitialized = useRef(false);
  const vfUpdateScheduled = useRef(false);

  const scheduleVectorFieldUpdate = useCallback(
    (nextCharges: Charge[]) => {
      if (!vectorFieldRenderer) return;
      if (vfUpdateScheduled.current) return;
      vfUpdateScheduled.current = true;
      requestAnimationFrame(() => {
        vfUpdateScheduled.current = false;
        if (vectorFieldRenderer) {
          const shouldBeVisible = showVectorField;
          vectorFieldRenderer.updateCharges(nextCharges);
          if (shouldBeVisible) {
            vectorFieldRenderer.setVisible(true);
          }
        }
        if (fieldLineRenderer) {
          fieldLineRenderer.updateCharges(nextCharges);
        }
      });
    },
    [vectorFieldRenderer, fieldLineRenderer, showVectorField],
  );

  const addCharge = useCallback(() => {
    const newCharge = createCharge(
      new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
      ),
      Math.random() > 0.5 ? 1e-6 : -1e-6,
      `charge-${Date.now()}`,
    );

    const newCharges = [...chargesState, newCharge];
    charges = newCharges;
    setChargesState(newCharges);
    setChargeStack((prev) => [...prev, newCharge.id]);
    updateChargeMeshes();
    scheduleVectorFieldUpdate(newCharges);

    // If FDTD is running, re-sync sources and restart
    if (fdtdRunning) {
      injectChargesIntoFDTD(newCharges);
    }
  }, [chargesState, scheduleVectorFieldUpdate]);

  const removeCharge = useCallback(
    (chargeId: string) => {
      const newCharges = chargesState.filter((charge) => charge.id !== chargeId);
      charges = newCharges;
      setChargesState(newCharges);
      setSelectedCharge(null);
      selectedChargeId = null;

      setChargeStack((prev) => prev.filter((id) => id !== chargeId));

      updateChargeMeshes();
      scheduleVectorFieldUpdate(newCharges);

      if (fdtdRunning) {
        injectChargesIntoFDTD(newCharges);
      }
    },
    [chargesState, scheduleVectorFieldUpdate],
  );

  const removeLastAdded = useCallback(() => {
    if (chargeStack.length > 0) {
      const lastChargeId = chargeStack[chargeStack.length - 1];
      removeCharge(lastChargeId);
    }
  }, [chargeStack, removeCharge]);

  const removeAllCharges = useCallback(() => {
    charges = [];
    setChargesState([]);
    setSelectedCharge(null);
    setChargeStack([]);
    selectedChargeId = null;
    updateChargeMeshes();
    scheduleVectorFieldUpdate([]);

    if (fdtdRunning) {
      injectChargesIntoFDTD([]);
    }
  }, [scheduleVectorFieldUpdate]);

  const selectCharge = useCallback(
    (chargeId: string) => {
      const charge = chargesState.find((c) => c.id === chargeId);
      if (charge) {
        setSelectedCharge(charge);
        selectedChargeId = chargeId;
        updateChargeMeshes();
      }
    },
    [chargesState],
  );

  const updateChargeMagnitude = useCallback(
    (chargeId: string, magnitude: number) => {
      const newCharges = chargesState.map((charge) =>
        charge.id === chargeId ? { ...charge, magnitude } : charge,
      );
      charges = newCharges;
      setChargesState(newCharges);
      updateChargeMeshes();
      scheduleVectorFieldUpdate(newCharges);

      // Re-inject into FDTD (magnitude affects polarity)
      injectChargesIntoFDTD(newCharges);
    },
    [chargesState, scheduleVectorFieldUpdate],
  );

  const updateChargePosition = useCallback(
    (chargeId: string, position: THREE.Vector3) => {
      const newCharges = chargesState.map((charge) =>
        charge.id === chargeId ? { ...charge, position: position.clone() } : charge,
      );
      charges = newCharges;
      setChargesState(newCharges);
      updateChargeMeshes();
      if (vectorFieldRenderer && showVectorField) {
        scheduleVectorFieldUpdate(newCharges);
      }

      // Re-inject into FDTD (position changed)
      injectChargesIntoFDTD(newCharges);
    },
    [chargesState, scheduleVectorFieldUpdate, vectorFieldRenderer, showVectorField],
  );

  // Voltage point management (points store physically computed potentials)
  const addVoltagePoint = useCallback(() => {
    const position = new THREE.Vector3(
      newVoltagePoint.x,
      newVoltagePoint.y,
      newVoltagePoint.z,
    );
    const fieldResult = electricFieldAt(position, chargesRef.current);
    const newPoint = createVoltagePoint(position, fieldResult.potential);
    const updated = [...voltagePoints, newPoint];
    setVoltagePoints(updated);
    updateVoltagePointMeshes(updated);
    setShowVoltagePointUI(false);
  }, [newVoltagePoint, voltagePoints]);

  const removeVoltagePoint = useCallback(
    (pointId: string) => {
      const newPoints = voltagePoints.filter((point) => point.id !== pointId);
      setVoltagePoints(newPoints);
      updateVoltagePointMeshes(newPoints);
    },
    [voltagePoints],
  );

  const removeAllVoltagePoints = useCallback(() => {
    setVoltagePoints([]);
    updateVoltagePointMeshes([]);
  }, []);

  const handleMouseClick = useCallback(
    (event: MouseEvent) => {
      if (!controls) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      // Two-point probe: intercept clicks to place points on y=0 plane
      if (probeModeRef.current) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersection = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(plane, intersection);
        if (!hit) return;

        if (!probePointARef.current) {
          setProbePointA(intersection.clone());
        } else {
          const result = computeTwoPointProbe(probePointARef.current, intersection.clone(), chargesRef.current);
          setProbeResult(result);
          setProbeMode(false);
          setProbePointA(null);
        }
        return;
      }

      if (lineProbeModeRef.current) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersection = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(plane, intersection);
        if (!hit) return;

        setLineProbeWaypoints(prev => [...prev, intersection.clone()]);
        return;
      }

      const chargeIntersects = raycaster.intersectObjects(
        Array.from(chargeMeshes.values()),
      );
      const voltageIntersects = raycaster.intersectObjects(
        Array.from(voltagePointMeshes.values()),
      );

      if (chargeIntersects.length > 0) {
        const clickedChargeId = chargeIntersects[0].object.userData.chargeId;
        selectCharge(clickedChargeId);
      } else if (voltageIntersects.length > 0) {
        console.log(
          'Voltage point clicked:',
          voltageIntersects[0].object.userData.voltagePointId,
        );
      } else {
        setShowVoltagePointUI(true);
        setSelectedCharge(null);
        selectedChargeId = null;
        updateChargeMeshes();
      }
    },
    [selectCharge],
  );

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

    if (!vectorFieldInitialized.current) {
    const vectorFieldConfig = createDefaultVectorFieldConfig();
    const vfRenderer = new VectorFieldRenderer(scene, vectorFieldConfig);
    vfRenderer.updateCharges(charges);
    vfRenderer.setVisible(false);  // Hidden by default — FDTD heatmap is primary
    setVectorFieldRenderer(vfRenderer);
      vectorFieldInitialized.current = true;
    }

    if (!fieldLineInitialized.current) {
      const fieldLineConfig = createDefaultFieldLineConfig();
      const flRenderer = new FieldLineRenderer(scene, fieldLineConfig);
      flRenderer.updateCharges(charges);
      flRenderer.setVisible(showFieldLines);
      setFieldLineRenderer(flRenderer);
      fieldLineInitialized.current = true;
    }

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

    // Hover voltage tracking over plane y = 0
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
        const fieldResult = electricFieldAt(pos, chargesRef.current);
        setHoverVoltage(fieldResult.potential);
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
      if (vectorFieldRenderer) {
        vectorFieldRenderer.dispose();
      }
      if (fieldLineRenderer) {
        fieldLineRenderer.dispose();
      }
    };
  }, [handleMouseClick, vectorFieldRenderer]);

  // Keep voltage point meshes in sync with state
  useEffect(() => {
    updateVoltagePointMeshes(voltagePoints);
  }, [voltagePoints]);

  const toggleVectorField = () => {
    const newVisibility = !showVectorField;
    setShowVectorField(newVisibility);
    if (vectorFieldRenderer) {
      vectorFieldRenderer.setVisible(newVisibility);
    }
  };

  const toggleFieldLines = () => {
    const newVisibility = !showFieldLines;
    setShowFieldLines(newVisibility);
    if (fieldLineRenderer) {
      fieldLineRenderer.setVisible(newVisibility);
    }
  };

  // FDTD is always running — no toggle needed

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

        <div style={{ marginBottom: '8px' }}>
          <div>Charges: {chargesState.length}</div>
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
            onClick={addCharge}
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
            + Add Charge
          </button>

          {chargeStack.length > 0 && (
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

          {chargesState.length > 0 && (
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
          {/* Wave simulation controls (FDTD always running) */}
          <div style={{
            fontSize: '10px',
            color: '#aaa',
            marginTop: '5px',
            padding: '6px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '3px',
          }}>
            <div style={{ fontSize: '11px', color: '#8bc34a', marginBottom: '4px' }}>
              Wave Simulation (Maxwell)
            </div>
            <div style={{ marginTop: '4px' }}>
              <label>Speed: </label>
              <input
                type="range"
                min="1"
                max="20"
                defaultValue="5"
                onChange={(e) => { fdtdStepsPerFrame = parseInt(e.target.value); }}
                style={{ width: '100px', verticalAlign: 'middle' }}
              />
            </div>
            <button
              onClick={() => {
                injectChargesIntoFDTD(chargesRef.current);
              }}
              style={{
                marginTop: '4px',
                padding: '4px 8px',
                background: '#ff9800',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '10px',
              }}
            >
              Reset Waves
            </button>
          </div>
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

        <button
          onClick={() => {
            setProbeMode(!probeMode);
            setProbePointA(null);
            setProbeResult(null);
          }}
          style={{
            padding: '8px 12px',
            background: probeMode ? '#ff9800' : '#9C27B0',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '10px',
            fontSize: '11px',
            width: '100%',
          }}
        >
          {probeMode ? 'Cancel Probe' : 'Two-Point Probe'}
        </button>

        {probeMode && (
          <div
            style={{
              marginBottom: '10px',
              padding: '8px',
              background: 'rgba(156, 39, 176, 0.2)',
              border: '1px solid #9C27B0',
              borderRadius: '4px',
              fontSize: '11px',
            }}
          >
            {!probePointA
              ? 'Click on the grid to place Point A'
              : 'Click on the grid to place Point B'}
          </div>
        )}

        {/* Two-point probe: enter coordinates manually */}
        {!probeMode && !probeResult && (
          <div
            style={{
              marginBottom: '10px',
              padding: '8px',
              background: 'rgba(156, 39, 176, 0.1)',
              border: '1px solid #555',
              borderRadius: '4px',
              fontSize: '11px',
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Probe by Coordinates</div>
            <div style={{ marginBottom: '4px' }}>Point A:</div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <input
                  key={`a-${axis}`}
                  type="number"
                  value={probeInputA[axis]}
                  onChange={(e) => setProbeInputA(prev => ({ ...prev, [axis]: e.target.value }))}
                  placeholder={axis}
                  style={{
                    flex: 1,
                    padding: '3px',
                    background: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    border: '1px solid #555',
                    borderRadius: '3px',
                    fontSize: '11px',
                    width: '50px',
                  }}
                />
              ))}
            </div>
            <div style={{ marginBottom: '4px' }}>Point B:</div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <input
                  key={`b-${axis}`}
                  type="number"
                  value={probeInputB[axis]}
                  onChange={(e) => setProbeInputB(prev => ({ ...prev, [axis]: e.target.value }))}
                  placeholder={axis}
                  style={{
                    flex: 1,
                    padding: '3px',
                    background: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    border: '1px solid #555',
                    borderRadius: '3px',
                    fontSize: '11px',
                    width: '50px',
                  }}
                />
              ))}
            </div>
            <button
              onClick={() => {
                const a = new THREE.Vector3(
                  parseFloat(probeInputA.x) || 0,
                  parseFloat(probeInputA.y) || 0,
                  parseFloat(probeInputA.z) || 0,
                );
                const b = new THREE.Vector3(
                  parseFloat(probeInputB.x) || 0,
                  parseFloat(probeInputB.y) || 0,
                  parseFloat(probeInputB.z) || 0,
                );
                const result = computeTwoPointProbe(a, b, chargesRef.current);
                setProbeResult(result);
              }}
              style={{
                padding: '6px 10px',
                background: '#9C27B0',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '11px',
                width: '100%',
              }}
            >
              Compute
            </button>
          </div>
        )}

        {probeResult && !probeMode && (
          <div
            style={{
              marginBottom: '10px',
              padding: '10px',
              background: 'rgba(156, 39, 176, 0.15)',
              border: '1px solid #9C27B0',
              borderRadius: '4px',
              fontSize: '11px',
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
              Two-Point Probe Results
            </div>
            <div style={{ marginBottom: '3px' }}>
              A: ({probeResult.pointA.x.toFixed(2)}, {probeResult.pointA.y.toFixed(2)}, {probeResult.pointA.z.toFixed(2)})
            </div>
            <div style={{ marginBottom: '3px' }}>
              B: ({probeResult.pointB.x.toFixed(2)}, {probeResult.pointB.y.toFixed(2)}, {probeResult.pointB.z.toFixed(2)})
            </div>
            <div style={{ marginBottom: '3px' }}>
              V(A): {probeResult.voltageA.toExponential(2)} V
            </div>
            <div style={{ marginBottom: '3px' }}>
              V(B): {probeResult.voltageB.toExponential(2)} V
            </div>
            <div style={{ marginBottom: '3px', color: '#ce93d8' }}>
              {'\u0394'}V: {probeResult.deltaV.toExponential(2)} V
            </div>
            <div style={{ marginBottom: '3px' }}>
              Distance: {probeResult.distance.toFixed(3)} m
            </div>
            <div style={{ marginBottom: '6px', color: '#ce93d8' }}>
              {'\u222B'}E{'\u00B7'}dl: {probeResult.eDotDl.toExponential(2)} V/m{'\u00B7'}m
            </div>
            <button
              onClick={() => setProbeResult(null)}
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
              Clear
            </button>
          </div>
        )}

        <button
          onClick={() => {
            if (lineProbeMode) {
              // Cancel
              setLineProbeMode(false);
              setLineProbeWaypoints([]);
            } else {
              setLineProbeMode(true);
              setLineProbeWaypoints([]);
              setLineProbeResult(null);
            }
          }}
          style={{
            padding: '8px 12px',
            background: lineProbeMode ? '#ff9800' : '#00897B',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '10px',
            fontSize: '11px',
            width: '100%',
          }}
        >
          {lineProbeMode ? 'Cancel Path' : 'Line Path Probe'}
        </button>

        {lineProbeMode && (
          <div
            style={{
              marginBottom: '10px',
              padding: '8px',
              background: 'rgba(0, 137, 123, 0.2)',
              border: '1px solid #00897B',
              borderRadius: '4px',
              fontSize: '11px',
            }}
          >
            <div>Waypoints placed: {lineProbeWaypoints.length}</div>
            <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px', marginBottom: '6px' }}>
              Click on the grid or type coordinates below (min 2)
            </div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <input
                  key={`lp-${axis}`}
                  type="number"
                  value={lineProbeInput[axis]}
                  onChange={(e) => setLineProbeInput(prev => ({ ...prev, [axis]: e.target.value }))}
                  placeholder={axis}
                  style={{
                    flex: 1,
                    padding: '3px',
                    background: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    border: '1px solid #555',
                    borderRadius: '3px',
                    fontSize: '11px',
                    width: '50px',
                  }}
                />
              ))}
            </div>
            <button
              onClick={() => {
                const pt = new THREE.Vector3(
                  parseFloat(lineProbeInput.x) || 0,
                  parseFloat(lineProbeInput.y) || 0,
                  parseFloat(lineProbeInput.z) || 0,
                );
                setLineProbeWaypoints(prev => [...prev, pt]);
              }}
              style={{
                padding: '5px 8px',
                background: '#00897B',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '10px',
                width: '100%',
                marginBottom: '6px',
              }}
            >
              + Add Waypoint
            </button>
            {lineProbeWaypoints.length >= 2 && (
              <button
                onClick={finishLinePath}
                style={{
                  marginTop: '6px',
                  padding: '6px 10px',
                  background: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  width: '100%',
                }}
              >
                Finish Path ({lineProbeWaypoints.length} points)
              </button>
            )}
          </div>
        )}

        {lineProbeResult && !lineProbeMode && (
          <div
            style={{
              marginBottom: '10px',
              padding: '10px',
              background: 'rgba(0, 137, 123, 0.15)',
              border: '1px solid #00897B',
              borderRadius: '4px',
              fontSize: '11px',
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
              Line Probe Results
            </div>
            <div style={{ marginBottom: '3px' }}>
              Waypoints: {lineProbeResult.waypoints.length} | Distance: {lineProbeResult.totalDistance.toFixed(2)} m
            </div>

            {/* Mini SVG graph of voltage along path */}
            {lineProbeResult.data.length > 1 && (() => {
              const graphW = 230;
              const graphH = 80;
              const pad = { top: 10, right: 10, bottom: 20, left: 10 };
              const w = graphW - pad.left - pad.right;
              const h = graphH - pad.top - pad.bottom;

              const data = lineProbeResult.data;
              const maxDist = data[data.length - 1].distance || 1;
              const voltages = data.map(d => d.voltage);
              const minV = Math.min(...voltages);
              const maxV = Math.max(...voltages);
              const rangeV = maxV - minV || 1;

              const voltagePath = data
                .map((d, i) => {
                  const x = pad.left + (d.distance / maxDist) * w;
                  const y = pad.top + h - ((d.voltage - minV) / rangeV) * h;
                  return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(' ');

              const fieldMags = data.map(d => d.fieldMagnitude);
              const minF = Math.min(...fieldMags);
              const maxF = Math.max(...fieldMags);
              const rangeF = maxF - minF || 1;

              const fieldPath = data
                .map((d, i) => {
                  const x = pad.left + (d.distance / maxDist) * w;
                  const y = pad.top + h - ((d.fieldMagnitude - minF) / rangeF) * h;
                  return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(' ');

              return (
                <div>
                  <svg width={graphW} height={graphH} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '3px' }}>
                    {/* Axis line */}
                    <line x1={pad.left} y1={pad.top + h} x2={pad.left + w} y2={pad.top + h} stroke="#555" strokeWidth={1} />
                    {/* Voltage line (yellow) */}
                    <path d={voltagePath} fill="none" stroke="#ffeb3b" strokeWidth={1.5} />
                    {/* Field magnitude line (cyan) */}
                    <path d={fieldPath} fill="none" stroke="#00e5ff" strokeWidth={1.5} />
                    {/* Labels */}
                    <text x={pad.left} y={graphH - 2} fill="#ffeb3b" fontSize="8">V</text>
                    <text x={pad.left + 12} y={graphH - 2} fill="#00e5ff" fontSize="8">|E|</text>
                    <text x={pad.left + w} y={graphH - 2} fill="#888" fontSize="8" textAnchor="end">
                      {maxDist.toFixed(1)}m
                    </text>
                  </svg>
                  <div style={{ fontSize: '9px', color: '#aaa', marginTop: '2px' }}>
                    <span style={{ color: '#ffeb3b' }}>V</span>: {minV.toExponential(1)} to {maxV.toExponential(1)} V
                    {' | '}
                    <span style={{ color: '#00e5ff' }}>|E|</span>: {minF.toExponential(1)} to {maxF.toExponential(1)}
                  </div>
                </div>
              );
            })()}

            <button
              onClick={() => setLineProbeResult(null)}
              style={{
                marginTop: '6px',
                padding: '4px 8px',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '10px',
              }}
            >
              Clear
            </button>
          </div>
        )}

        {selectedCharge && (
          <div
            style={{
              border: '1px solid #555',
              padding: '10px',
              borderRadius: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
              Selected Charge: {selectedCharge.id}
            </div>

            <div style={{ marginBottom: '5px' }}>
              <label style={{ display: 'block', marginBottom: '2px' }}>
                Magnitude (μC):
              </label>
              <input
                type="number"
                value={(selectedCharge.magnitude * 1e6).toFixed(2)}
                onChange={(e) => {
                  const newMagnitude = parseFloat(e.target.value) * 1e-6;
                  updateChargeMagnitude(selectedCharge.id, newMagnitude);
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
                      const newPos = selectedCharge.position.clone();
                      newPos.x = numVal;
                      updateChargePosition(selectedCharge.id, newPos);
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
                      const newPos = selectedCharge.position.clone();
                      newPos.y = numVal;
                      updateChargePosition(selectedCharge.id, newPos);
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
                      const newPos = selectedCharge.position.clone();
                      newPos.z = numVal;
                      updateChargePosition(selectedCharge.id, newPos);
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
