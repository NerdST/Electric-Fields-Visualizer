import React, { useRef, useEffect, useState, useCallback } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createDefaultCharge, createCharge } from '../physics/Charge';
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

// Create charge spheres
const chargeGeometry = new THREE.SphereGeometry(0.2, 16, 16);
const positiveChargeMaterial = new THREE.MeshStandardMaterial({ color: 0xff4444 });
const negativeChargeMaterial = new THREE.MeshStandardMaterial({ color: 0x4444ff });

// Add some default charges
const charge1 = createDefaultCharge('charge-1');
charge1.position.set(0, 0, 0);
charge1.magnitude = 1e-6;

// const charge2 = createDefaultCharge('charge-2');
// charge2.position.set(-2, 0, 0);
// charge2.magnitude = -1e-6;

let charges: Charge[] = [charge1]; //[charge1, charge2];

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
  opacity: 0.8 
});

// Arrow geometry for voltage points (same size as field arrows)
const voltageArrowGeometry = new THREE.ConeGeometry(0.05, 0.2, 8);
const voltageArrowMaterial = new THREE.MeshBasicMaterial({ 
  color: 0x4444ff, // Blue color
  transparent: true, 
  opacity: 0.8 
});

const updateChargeMeshes = () => {
  const seen: Set<string> = new Set();

  for (const charge of charges) {
    seen.add(charge.id);
    let mesh = chargeMeshes.get(charge.id);
    const desiredMaterial = charge.magnitude > 0 ? positiveChargeMaterial : negativeChargeMaterial;
    if (!mesh) {
      mesh = new THREE.Mesh(chargeGeometry, desiredMaterial);
      mesh.userData = { chargeId: charge.id };
      scene.add(mesh);
      chargeMeshes.set(charge.id, mesh);
    } else {
      // If sign changed, swap material
      const isPositive = mesh.material === positiveChargeMaterial;
      if ((isPositive && charge.magnitude < 0) || (!isPositive && charge.magnitude > 0)) {
        mesh.material = desiredMaterial;
      }
    }
    mesh.position.copy(charge.position);

    // Selection highlight
    mesh.scale.setScalar(selectedChargeId === charge.id ? 1.5 : 1.0);
    // Remove any existing outline
    mesh.children
      .filter(c => (c as any).isMesh)
      .forEach(child => mesh && mesh.remove(child));
    if (selectedChargeId === charge.id) {
      const outlineGeometry = new THREE.SphereGeometry(0.25, 16, 16);
      const outlineMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffff00, 
        wireframe: true,
        transparent: true,
        opacity: 0.8
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

  // Directions for the arrows (6 cardinal directions)
  const directions = [
    new THREE.Vector3(1, 0, 0),   // +x
    new THREE.Vector3(-1, 0, 0), // -x
    new THREE.Vector3(0, 1, 0),   // +y
    new THREE.Vector3(0, -1, 0),  // -y
    new THREE.Vector3(0, 0, 1),   // +z
    new THREE.Vector3(0, 0, -1)  // -z
  ];
  const upVector = new THREE.Vector3(0, 1, 0);

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
    if (!arrows) {
      arrows = [];
      const sphereRadius = 0.15; // Radius of the voltage point sphere
      const arrowLength = 0.2; // Length of the arrow
      const offset = sphereRadius + arrowLength / 2; // Offset to start arrow from sphere surface
      
      for (let i = 0; i < directions.length; i++) {
        const direction = directions[i];
        const arrow = new THREE.Mesh(voltageArrowGeometry, voltageArrowMaterial);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, direction.clone().normalize());
        arrow.setRotationFromQuaternion(quaternion);
        // Position arrow so it extends outward from the sphere surface
        arrow.position.copy(point.position).add(direction.clone().multiplyScalar(offset));
        scene.add(arrow);
        arrows.push(arrow);
      }
      voltagePointArrows.set(point.id, arrows);
    } else {
      // Update arrow positions
      const sphereRadius = 0.15;
      const arrowLength = 0.2;
      const offset = sphereRadius + arrowLength / 2;
      
      for (let i = 0; i < arrows.length; i++) {
        const arrow = arrows[i];
        const direction = directions[i];
        arrow.position.copy(point.position).add(direction.clone().multiplyScalar(offset));
      }
    }
  }

  // Remove meshes and arrows that no longer have voltage points
  for (const [id, mesh] of Array.from(voltagePointMeshes.entries())) {
    if (!seen.has(id)) {
      scene.remove(mesh);
      voltagePointMeshes.delete(id);
      
      // Remove arrows
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
  const [vectorFieldRenderer, setVectorFieldRenderer] = useState<VectorFieldRenderer | null>(null);
  const [showVectorField, setShowVectorField] = useState(true);
  const [chargesState, setChargesState] = useState<Charge[]>(charges);
  const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);
  const [chargeStack, setChargeStack] = useState<string[]>([]);
  const [voltagePoints, setVoltagePoints] = useState<VoltagePoint[]>([]);
  const [showVoltagePointUI, setShowVoltagePointUI] = useState(false);
  const [newVoltagePoint, setNewVoltagePoint] = useState({
    x: 0,
    y: 0,
    z: 0,
    voltage: 0
  });
  const vectorFieldInitialized = useRef(false);

  const vfUpdateScheduled = useRef(false);
  const scheduleVectorFieldUpdate = useCallback((nextCharges: Charge[]) => {
    if (!vectorFieldRenderer) return;
    if (vfUpdateScheduled.current) return;
    vfUpdateScheduled.current = true;
    requestAnimationFrame(() => {
      vfUpdateScheduled.current = false;
      vectorFieldRenderer.updateCharges(nextCharges);
    });
  }, [vectorFieldRenderer]);

  // Charge management functions
  const addCharge = useCallback(() => {
    const newCharge = createCharge(
      new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      ),
      Math.random() > 0.5 ? 1e-6 : -1e-6,
      `charge-${Date.now()}`
    );
    
    const newCharges = [...chargesState, newCharge];
    charges = newCharges;
    setChargesState(newCharges);
    setChargeStack(prev => [...prev, newCharge.id]);
    updateChargeMeshes();
    scheduleVectorFieldUpdate(newCharges);
  }, [chargesState, vectorFieldRenderer]);

  const removeCharge = useCallback((chargeId: string) => {
    const newCharges = chargesState.filter(charge => charge.id !== chargeId);
    charges = newCharges;
    setChargesState(newCharges);
    setSelectedCharge(null);
    selectedChargeId = null;
    
    setChargeStack(prev => prev.filter(id => id !== chargeId));
    
    updateChargeMeshes();
    scheduleVectorFieldUpdate(newCharges);
  }, [chargesState, vectorFieldRenderer]);

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
  }, [vectorFieldRenderer]);

  const selectCharge = useCallback((chargeId: string) => {
    const charge = chargesState.find(c => c.id === chargeId);
    if (charge) {
      setSelectedCharge(charge);
      selectedChargeId = chargeId;
      updateChargeMeshes();
    }
  }, [chargesState]);

  const updateChargeMagnitude = useCallback((chargeId: string, magnitude: number) => {
    const newCharges = chargesState.map(charge => 
      charge.id === chargeId ? { ...charge, magnitude } : charge
    );
    charges = newCharges;
    setChargesState(newCharges);
    updateChargeMeshes();
    scheduleVectorFieldUpdate(newCharges);
  }, [chargesState, vectorFieldRenderer]);

  const updateChargePosition = useCallback((chargeId: string, position: THREE.Vector3) => {
    const newCharges = chargesState.map(charge => 
      charge.id === chargeId ? { ...charge, position: position.clone() } : charge
    );
    charges = newCharges;
    setChargesState(newCharges);
    updateChargeMeshes();
    scheduleVectorFieldUpdate(newCharges);
  }, [chargesState, vectorFieldRenderer]);

  // Voltage point management functions
  const addVoltagePoint = useCallback(() => {
    const position = new THREE.Vector3(newVoltagePoint.x, newVoltagePoint.y, newVoltagePoint.z);
    const newPoint = createVoltagePoint(position, newVoltagePoint.voltage);
    setVoltagePoints(prev => [...prev, newPoint]);
    updateVoltagePointMeshes([...voltagePoints, newPoint]);
    setShowVoltagePointUI(false);
  }, [voltagePoints, newVoltagePoint]);

  const removeVoltagePoint = useCallback((pointId: string) => {
    const newPoints = voltagePoints.filter(point => point.id !== pointId);
    setVoltagePoints(newPoints);
    updateVoltagePointMeshes(newPoints);
  }, [voltagePoints]);

  const removeAllVoltagePoints = useCallback(() => {
    setVoltagePoints([]);
    updateVoltagePointMeshes([]);
  }, []);

  const handleMouseClick = useCallback((event: MouseEvent) => {
    if (!controls) return;
    
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const chargeIntersects = raycaster.intersectObjects(Array.from(chargeMeshes.values()));
    const voltageIntersects = raycaster.intersectObjects(Array.from(voltagePointMeshes.values()));
    
    if (chargeIntersects.length > 0) {
      const clickedChargeId = chargeIntersects[0].object.userData.chargeId;
      selectCharge(clickedChargeId);
    } else if (voltageIntersects.length > 0) {
      // Handle voltage point selection if needed
      console.log('Voltage point clicked:', voltageIntersects[0].object.userData.voltagePointId);
    } else {
      // Clicked on empty space - show voltage point UI
      setShowVoltagePointUI(true);
      setSelectedCharge(null);
      selectedChargeId = null;
      updateChargeMeshes();
    }
  }, [selectCharge]);

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

    // Initialize vector field renderer (only if not already created)
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

    animate();

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('click', handleMouseClick);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      if (vectorFieldRenderer) {
        vectorFieldRenderer.dispose();
      }
    };
  }, []);

  // Update voltage point meshes when voltage points change
  useEffect(() => {
    updateVoltagePointMeshes(voltagePoints);
  }, [voltagePoints]);

  const toggleVectorField = () => {
    const newVisibility = !showVectorField;
    console.log('Toggling vector field visibility to:', newVisibility);
    console.log('Scene children count:', scene.children.length);
    console.log('Scene children:', scene.children.map(child => child.type));
    setShowVectorField(newVisibility);
    if (vectorFieldRenderer) {
      console.log('Setting vector field renderer visibility to:', newVisibility);
      vectorFieldRenderer.setVisible(newVisibility);
    } else {
      console.log('Vector field renderer is null!');
    }
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#282c34' }} />
      
      {/* Control panel */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '15px',
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '12px',
        minWidth: '250px'
      }}>
        <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
          Electric Field Visualizer
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <div>Charges: {chargesState.length}</div>
          <div style={{ fontSize: '10px', color: '#ccc' }}>
            Click charges to select, click empty space to deselect
          </div>
        </div>

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
              fontSize: '11px'
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
                fontSize: '11px'
              }}
            >
              - Remove Last Added
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
                fontSize: '11px'
              }}
            >
              🗑️ Remove All
            </button>
          )}
        </div>

        <button 
          onClick={toggleVectorField}
          style={{
            padding: '8px 12px',
            background: showVectorField ? '#4CAF50' : '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '10px',
            fontSize: '11px'
          }}
        >
          {showVectorField ? 'Hide' : 'Show'} Vector Field
        </button>

        {selectedCharge && (
          <div style={{ 
            border: '1px solid #555', 
            padding: '10px', 
            borderRadius: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
              Selected Charge: {selectedCharge.id}
            </div>
            
            <div style={{ marginBottom: '5px' }}>
              <label style={{ display: 'block', marginBottom: '2px' }}>Magnitude (μC):</label>
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
                  fontSize: '11px'
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
                  fontSize: '11px'
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
                  fontSize: '11px'
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
                  fontSize: '11px'
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Voltage Point UI - Top Right */}
      {showVoltagePointUI && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '15px',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '12px',
          minWidth: '250px'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
            Add Voltage Measurement Point
          </div>
          
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px' }}>Position X:</label>
            <input
              type="number"
              value={newVoltagePoint.x}
              onChange={(e) => setNewVoltagePoint(prev => ({ ...prev, x: parseFloat(e.target.value) || 0 }))}
              style={{
                width: '100%',
                padding: '4px',
                borderRadius: '3px',
                border: '1px solid #555',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                fontSize: '11px'
              }}
            />
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '2px' }}>Position Y:</label>
            <input
              type="number"
              value={newVoltagePoint.y}
              onChange={(e) => setNewVoltagePoint(prev => ({ ...prev, y: parseFloat(e.target.value) || 0 }))}
              style={{
                width: '100%',
                padding: '4px',
                borderRadius: '3px',
                border: '1px solid #555',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                fontSize: '11px'
              }}
            />
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '2px' }}>Position Z:</label>
            <input
              type="number"
              value={newVoltagePoint.z}
              onChange={(e) => setNewVoltagePoint(prev => ({ ...prev, z: parseFloat(e.target.value) || 0 }))}
              style={{
                width: '100%',
                padding: '4px',
                borderRadius: '3px',
                border: '1px solid #555',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                fontSize: '11px'
              }}
            />
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '2px' }}>Voltage (V):</label>
            <input
              type="number"
              value={newVoltagePoint.voltage}
              onChange={(e) => setNewVoltagePoint(prev => ({ ...prev, voltage: parseFloat(e.target.value) || 0 }))}
              style={{
                width: '100%',
                padding: '4px',
                borderRadius: '3px',
                border: '1px solid #555',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                fontSize: '11px'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '5px' }}>
            <button 
              onClick={addVoltagePoint}
              style={{
                padding: '8px 12px',
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                flex: 1
              }}
            >
              Add Point
            </button>
            
            <button 
              onClick={() => setShowVoltagePointUI(false)}
              style={{
                padding: '8px 12px',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                flex: 1
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Voltage Points List - Bottom Right */}
      {voltagePoints.length > 0 && (
        <div style={{
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
          overflowY: 'auto'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
            Voltage Points ({voltagePoints.length})
          </div>
          
          {voltagePoints.map((point, index) => (
            <div key={point.id} style={{
              border: '1px solid #555',
              padding: '8px',
              marginBottom: '5px',
              borderRadius: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                Point {index + 1}
              </div>
              <div style={{ fontSize: '10px', marginBottom: '2px' }}>
                Position: ({point.position.x.toFixed(2)}, {point.position.y.toFixed(2)}, {point.position.z.toFixed(2)})
              </div>
              <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                Voltage: {point.voltage} V
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
                  fontSize: '10px'
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
                marginTop: '10px'
              }}
            >
              🗑️ Remove All
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ThreeWorkspace;