import React, { useRef, useEffect, useState, useCallback } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createDefaultCharge, createCharge, electricFieldAt } from '../models/Charge';
import type { Charge } from '../models/Charge';
import {
  createDefaultSource,
  evaluateSourcesToCharges,
  type SimulationSource,
  type SourceWaveformType,
} from '../models/SimulationSource';
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
// Shared outline — created once and reused on the selected charge mesh each frame.
const outlineGeometry = new THREE.SphereGeometry(0.25, 16, 16);
const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true, transparent: true, opacity: 0.8 });

// Add some default charges
const charge1 = createDefaultCharge('charge-1');
charge1.position.set(0, 0, 0);
charge1.magnitude = 1e-6;

const source1 = createDefaultSource('charge-1', charge1.position.clone());
source1.waveform.offset = charge1.magnitude;

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

    // Selection highlight — only mutate the child outline when selection state changes.
    const isSelected = selectedChargeId === charge.id;
    if (mesh.userData.outlined !== isSelected) {
      mesh.children
        .filter((c) => (c as any).isMesh)
        .forEach((child) => mesh && mesh.remove(child));
      if (isSelected) {
        mesh.add(new THREE.Mesh(outlineGeometry, outlineMaterial));
      }
      mesh.userData.outlined = isSelected;
    }
    mesh.scale.setScalar(isSelected ? 1.5 : 1.0);
  }

  for (const [id, mesh] of Array.from(chargeMeshes.entries())) {
    if (!seen.has(id)) {
      scene.remove(mesh);
      chargeMeshes.delete(id);
    }
  }
};

// Function to update voltage point meshes
const updateVoltagePointMeshes = (
  voltagePoints: VoltagePoint[],
  sampleFieldAt: (position: THREE.Vector3) => { field: THREE.Vector3; potential: number },
) => {
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
      const fieldResult = sampleFieldAt(arrowPos);
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

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  renderer.render(scene, camera);
}

const ThreeWorkspace: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [simulationMode, setSimulationMode] = useState<SimulationMode>('analytical');
  const [remoteServerUrl, setRemoteServerUrl] = useState('ws://localhost:8765/ws');
  const [simulationStats, setSimulationStats] = useState<SimulationStats>(
    {
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
    },
  );
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
  const [sourceDefs, setSourceDefs] = useState<SimulationSource[]>([source1]);
  const simulationClockRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  useEffect(() => {
    simulationProviderRef.current.dispose();
    simulationProviderRef.current = createSimulationProvider(simulationMode, remoteServerUrl);
    simulationProviderRef.current.setCharges(chargesState);
    simulationProviderRef.current.setSimulationPaused(fdtdPaused);
    simulationProviderRef.current.setTargetStepsPerSecond(fdtdTargetSps);
    setSimulationStats(simulationProviderRef.current.getStats());

    if (vectorFieldRenderer) {
      vectorFieldRenderer.updateCharges(chargesState);
    }
    if (fieldLineRenderer) {
      fieldLineRenderer.updateCharges(chargesState);
    }
  }, [simulationMode, remoteServerUrl]);

  const [vectorFieldRenderer, setVectorFieldRenderer] =
    useState<VectorFieldRenderer | null>(null);
  const [showVectorField, setShowVectorField] = useState(true);
  const [fieldLineRenderer, setFieldLineRenderer] =
    useState<FieldLineRenderer | null>(null);
  const [showFieldLines, setShowFieldLines] = useState(false);

  // Refs that always point to the latest renderer instances — used for stable access
  // in event handlers and intervals without stale closure issues.
  const vectorFieldRendererRef = useRef<VectorFieldRenderer | null>(null);
  const fieldLineRendererRef = useRef<FieldLineRenderer | null>(null);

  // Charge state mirrors global `charges`
  const [chargesState, setChargesState] = useState<Charge[]>(charges);
  const chargesRef = useRef<Charge[]>(chargesState);
  useEffect(() => {
    chargesRef.current = chargesState;
    simulationProviderRef.current.setCharges(chargesState);
  }, [chargesState]);

  // Vector field renderer — owned by this effect (safe under React 18 StrictMode double-invoke)
  useEffect(() => {
    const vectorFieldConfig = createDefaultVectorFieldConfig();
    vectorFieldConfig.fieldSampler = (position, _c) => sampleFieldAtPosition(position);
    const vfRenderer = new VectorFieldRenderer(scene, vectorFieldConfig);
    vfRenderer.updateCharges(charges);
    vectorFieldRendererRef.current = vfRenderer;
    setVectorFieldRenderer(vfRenderer);
    return () => {
      vfRenderer.dispose();
      vectorFieldRendererRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Field line renderer — owned by this effect (safe under React 18 StrictMode double-invoke).
  // 1 Hz refresh interval is co-located here so it's always tied to the live renderer instance.
  useEffect(() => {
    const fieldLineConfig = createDefaultFieldLineConfig();
    fieldLineConfig.fieldSampler = (position, c) => electricFieldAt(position, c);
    const flRenderer = new FieldLineRenderer(scene, fieldLineConfig);
    flRenderer.updateCharges(chargesRef.current);
    flRenderer.setVisible(false);
    fieldLineRendererRef.current = flRenderer;
    setFieldLineRenderer(flRenderer);
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

  useEffect(() => {
    const evaluatedCharges = evaluateSourcesToCharges(sourceDefs, simulationTimeSeconds);

    // Only push updates downstream when charge values actually differ.
    // For DC sources this skips redundant React re-renders and vector field resampling
    // every animation frame even though nothing changed.
    const prev = prevEvaluatedRef.current;
    const changed =
      evaluatedCharges.length !== prev.length ||
      evaluatedCharges.some((c, i) => {
        const p = prev[i];
        return c.magnitude !== p.magnitude || !c.position.equals(p.position);
      });

    prevEvaluatedRef.current = evaluatedCharges;
    charges = evaluatedCharges;
    updateChargeMeshes();

    if (changed) {
      setChargesState(evaluatedCharges);
      vectorFieldRendererRef.current?.updateCharges(evaluatedCharges);
    }
  }, [simulationTimeSeconds, sourceDefs]);

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
      return {
        ...point,
        voltage: samplePotentialAtPosition(point.position),
      };
    });
    setVoltagePoints(updated);
    updateVoltagePointMeshes(updated, sampleFieldAtPosition);
  }, [chargesState, sampleFieldAtPosition, samplePotentialAtPosition]);

  // Hover voltage readout
  const [hoverVoltage, setHoverVoltage] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<THREE.Vector3 | null>(null);

  // Charge management
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

    const newSource = createDefaultSource(newCharge.id, newCharge.position);
    newSource.waveform.offset = newCharge.magnitude;
    setSourceDefs((prev) => [...prev, newSource]);
    setChargeStack((prev) => [...prev, newCharge.id]);
  }, []);

  const removeCharge = useCallback(
    (chargeId: string) => {
      setSourceDefs((prev) => prev.filter((source) => source.id !== chargeId));
      setSelectedCharge(null);
      selectedChargeId = null;

      setChargeStack((prev) => prev.filter((id) => id !== chargeId));
    },
    [],
  );

  const removeLastAdded = useCallback(() => {
    if (chargeStack.length > 0) {
      const lastChargeId = chargeStack[chargeStack.length - 1];
      removeCharge(lastChargeId);
    }
  }, [chargeStack, removeCharge]);

  const removeAllCharges = useCallback(() => {
    setSourceDefs([]);
    setSelectedCharge(null);
    setChargeStack([]);
    selectedChargeId = null;
  }, []);

  const selectCharge = useCallback(
    (chargeId: string) => {
      // Use chargesRef (always current) instead of chargesState so this callback
      // is stable and doesn't change every frame, which would re-run the setup
      // useEffect and dispose the field line renderer.
      const charge = chargesRef.current.find((c) => c.id === chargeId);
      if (charge) {
        setSelectedCharge(charge);
        selectedChargeId = chargeId;
        updateChargeMeshes();
      }
    },
    [],
  );

  const updateChargeMagnitude = useCallback(
    (chargeId: string, magnitude: number) => {
      setSourceDefs((prev) => prev.map((source) => (
        source.id === chargeId
          ? {
            ...source,
            waveform: {
              ...source.waveform,
              offset: magnitude,
            },
          }
          : source
      )));
    },
    [],
  );

  const updateChargePosition = useCallback(
    (chargeId: string, position: THREE.Vector3) => {
      setSourceDefs((prev) => prev.map((source) => (
        source.id === chargeId
          ? {
            ...source,
            position: position.clone(),
          }
          : source
      )));
    },
    [],
  );

  // Voltage point management (points store physically computed potentials)
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

  const handleMouseClick = useCallback(
    (event: MouseEvent) => {
      if (!controls) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
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

  // Keep voltage point meshes in sync with state
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

  // Periodically refresh the vector field from the live simulation state.
  // invalidateFieldCache re-enqueues all known positions; the renderer re-reads
  // the cache (stale values stay until the fresh server response arrives).
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

  const selectedSource = selectedCharge
    ? sourceDefs.find((source) => source.id === selectedCharge.id) ?? null
    : null;

  const updateSelectedSourceWaveform = (
    field: 'type' | 'offset' | 'amplitude' | 'frequencyHz' | 'phaseRad' | 'dutyCycle',
    value: number | SourceWaveformType,
  ) => {
    if (!selectedSource) {
      return;
    }

    setSourceDefs((prev) => prev.map((source) => {
      if (source.id !== selectedSource.id) {
        return source;
      }
      return {
        ...source,
        waveform: {
          ...source.waveform,
          [field]: value,
        },
      };
    }));
  };

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
          <div>Sources: {sourceDefs.length}</div>
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
            + Add Source
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

        {selectedCharge && selectedSource && (
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
              <label style={{ display: 'block', marginBottom: '2px' }}>Source Type:</label>
              <select
                value={selectedSource.waveform.type}
                onChange={(e) => updateSelectedSourceWaveform('type', e.target.value as SourceWaveformType)}
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

            {selectedSource.waveform.type !== 'dc' && (
              <>
                <div style={{ marginBottom: '5px' }}>
                  <label style={{ display: 'block', marginBottom: '2px' }}>
                    Amplitude (μC):
                  </label>
                  <input
                    type="number"
                    value={(selectedSource.waveform.amplitude * 1e6).toFixed(2)}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isNaN(v)) {
                        updateSelectedSourceWaveform('amplitude', v * 1e-6);
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
                    value={selectedSource.waveform.frequencyHz}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isNaN(v)) {
                        updateSelectedSourceWaveform('frequencyHz', Math.max(0.001, v));
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

            {selectedSource.waveform.type === 'pulse' && (
              <div style={{ marginBottom: '5px' }}>
                <label style={{ display: 'block', marginBottom: '2px' }}>
                  Duty Cycle:
                </label>
                <input
                  type="range"
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  value={selectedSource.waveform.dutyCycle}
                  onChange={(e) => {
                    updateSelectedSourceWaveform('dutyCycle', parseFloat(e.target.value));
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
