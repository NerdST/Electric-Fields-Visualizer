import React, { useRef, useEffect, useState, useCallback } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createDefaultCharge, createCharge } from '../physics/Charge';
import type { Charge } from '../physics/Charge';
import { VectorFieldRenderer, createDefaultVectorFieldConfig } from '../visualization/VectorField';

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
let chargeMeshes: THREE.Mesh[] = [];
let selectedChargeId: string | null = null;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();

// Function to update charge meshes
const updateChargeMeshes = () => {
  // Remove existing meshes
  chargeMeshes.forEach(mesh => scene.remove(mesh));
  chargeMeshes = [];
  
  // Create new meshes
  charges.forEach((charge) => {
    const material = charge.magnitude > 0 ? positiveChargeMaterial : negativeChargeMaterial;
    const mesh = new THREE.Mesh(chargeGeometry, material);
    mesh.position.copy(charge.position);
    mesh.userData = { chargeId: charge.id };
    
    // Add selection highlight
    if (selectedChargeId === charge.id) {
      mesh.scale.setScalar(1.5);
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
    
    scene.add(mesh);
    chargeMeshes.push(mesh);
  });
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

  // Charge management functions
  const addCharge = useCallback(() => {
    const newCharge = createCharge(
      new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      ),
      Math.random() > 0.5 ? 1e-6 : -1e-6, // Random positive or negative
      `charge-${Date.now()}`
    );
    
    const newCharges = [...chargesState, newCharge];
    charges = newCharges;
    setChargesState(newCharges);
    setChargeStack(prev => [...prev, newCharge.id]);
    updateChargeMeshes();
    
    if (vectorFieldRenderer) {
      vectorFieldRenderer.updateCharges(newCharges);
    }
  }, [chargesState, vectorFieldRenderer]);

  const removeCharge = useCallback((chargeId: string) => {
    const newCharges = chargesState.filter(charge => charge.id !== chargeId);
    charges = newCharges;
    setChargesState(newCharges);
    setSelectedCharge(null);
    selectedChargeId = null;
    
    // Remove from stack
    setChargeStack(prev => prev.filter(id => id !== chargeId));
    
    updateChargeMeshes();
    
    if (vectorFieldRenderer) {
      vectorFieldRenderer.updateCharges(newCharges);
    }
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
    
    if (vectorFieldRenderer) {
      vectorFieldRenderer.updateCharges([]);
    }
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
    
    if (vectorFieldRenderer) {
      vectorFieldRenderer.updateCharges(newCharges);
    }
  }, [chargesState, vectorFieldRenderer]);

  const updateChargePosition = useCallback((chargeId: string, position: THREE.Vector3) => {
    const newCharges = chargesState.map(charge => 
      charge.id === chargeId ? { ...charge, position: position.clone() } : charge
    );
    charges = newCharges;
    setChargesState(newCharges);
    updateChargeMeshes();
    
    if (vectorFieldRenderer) {
      vectorFieldRenderer.updateCharges(newCharges);
    }
  }, [chargesState, vectorFieldRenderer]);

  // Mouse interaction for charge selection
  const handleMouseClick = useCallback((event: MouseEvent) => {
    if (!controls) return;
    
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(chargeMeshes);
    
    if (intersects.length > 0) {
      const clickedChargeId = intersects[0].object.userData.chargeId;
      selectCharge(clickedChargeId);
    } else {
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

    // Initialize vector field renderer
    const vectorFieldConfig = createDefaultVectorFieldConfig();
    const vfRenderer = new VectorFieldRenderer(scene, vectorFieldConfig);
    vfRenderer.updateCharges(charges);
    setVectorFieldRenderer(vfRenderer);

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
  }, [handleMouseClick]);

  const toggleVectorField = () => {
    const newVisibility = !showVectorField;
    setShowVectorField(newVisibility);
    if (vectorFieldRenderer) {
      vectorFieldRenderer.setVisible(newVisibility);
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
    </div>
  );
};

export default ThreeWorkspace;