import React, { useRef, useEffect, useState, useCallback } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createDefaultCharge, createCharge, electricFieldAt } from '../physics/Charge';
import type { Charge } from '../physics/Charge';
import { VectorFieldRenderer, createDefaultVectorFieldConfig } from '../visualization/VectorField';
import { createVoltagePoint } from '../physics/VoltagePoint';
import type { VoltagePoint } from '../physics/VoltagePoint';

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
const voltageOrbGeometry = new THREE.SphereGeometry(0.15, 16, 16);
const voltageOrbMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });

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
  const arrowOffset = sphereRadius + 0.1; // Distance from orb surface
  const arrowScale = 0.3; // Base arrow length
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
      
      if (field.length() < 1e-6) {
        // Hide arrow if field is too small
        arrow.scale.set(0, 0, 0);
        continue;
      }

      // Calculate arrow length based on field magnitude
      let arrowLength = field.length();
      const normalizedMagnitude = Math.min(arrowLength / maxFieldMagnitude, 1);
      arrowLength = Math.max(normalizedMagnitude * arrowScale, 0.1);

      const direction = field.clone().normalize();
      const arrowStartPos = point.position.clone().add(
        direction.clone().multiplyScalar(sphereRadius + arrowOffset)
      );
      arrow.position.copy(arrowStartPos);

      const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, direction);
      arrow.setRotationFromQuaternion(quaternion);
      
      // Scale arrow (length along Y axis)
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
  const [vectorFieldRenderer, setVectorFieldRenderer] =
    useState<VectorFieldRenderer | null>(null);
  const [showVectorField, setShowVectorField] = useState(true);

  // Charge state mirrors global `charges`
  const [chargesState, setChargesState] = useState<Charge[]>(charges);
  const chargesRef = useRef<Charge[]>(chargesState);
  useEffect(() => {
    chargesRef.current = chargesState;
  }, [chargesState]);

  const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);
  const [chargeStack, setChargeStack] = useState<string[]>([]);

  // Voltage measurement points (computed via electricFieldAt)
  const [voltagePoints, setVoltagePoints] = useState<VoltagePoint[]>([]);
  const [showVoltagePointUI, setShowVoltagePointUI] = useState(false);
  const [newVoltagePoint, setNewVoltagePoint] = useState({
    x: 0,
    y: 0,
    z: 0,
  });

  // Hover voltage readout
  const [hoverVoltage, setHoverVoltage] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<THREE.Vector3 | null>(null);

  const vectorFieldInitialized = useRef(false);
  const vfUpdateScheduled = useRef(false);

  const scheduleVectorFieldUpdate = useCallback(
    (nextCharges: Charge[]) => {
      if (!vectorFieldRenderer) return;
      if (vfUpdateScheduled.current) return;
      vfUpdateScheduled.current = true;
      requestAnimationFrame(() => {
        vfUpdateScheduled.current = false;
        vectorFieldRenderer.updateCharges(nextCharges);
      });
    },
    [vectorFieldRenderer],
  );

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

    const newCharges = [...chargesState, newCharge];
    charges = newCharges;
    setChargesState(newCharges);
    setChargeStack((prev) => [...prev, newCharge.id]);
    updateChargeMeshes();
    scheduleVectorFieldUpdate(newCharges);
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
      scheduleVectorFieldUpdate(newCharges);
    },
    [chargesState, scheduleVectorFieldUpdate],
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
      setVectorFieldRenderer(vfRenderer);
      vectorFieldInitialized.current = true;
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
            }}
          >
            {showVectorField ? 'Hide' : 'Show'} Vector Field
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
                type="number"
                value={selectedCharge.position.x.toFixed(2)}
                onChange={(e) => {
                  const newPos = selectedCharge.position.clone();
                  newPos.x = parseFloat(e.target.value);
                  updateChargePosition(selectedCharge.id, newPos);
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
                type="number"
                value={selectedCharge.position.y.toFixed(2)}
                onChange={(e) => {
                  const newPos = selectedCharge.position.clone();
                  newPos.y = parseFloat(e.target.value);
                  updateChargePosition(selectedCharge.id, newPos);
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
                type="number"
                value={selectedCharge.position.z.toFixed(2)}
                onChange={(e) => {
                  const newPos = selectedCharge.position.clone();
                  newPos.z = parseFloat(e.target.value);
                  updateChargePosition(selectedCharge.id, newPos);
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
