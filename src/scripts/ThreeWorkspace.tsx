import React, { useRef, useEffect, useState } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createDefaultCharge, createCharge, electricFieldAt } from '../physics/Charge';
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
const voltageOrbGeometry = new THREE.SphereGeometry(0.15, 16, 16);
const voltageOrbMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });

// Charge meshes will be managed in the component

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  renderer.render(scene, camera);
}

const ThreeWorkspace: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vectorFieldRenderer, setVectorFieldRenderer] = useState<VectorFieldRenderer | null>(null);
  const [showVectorField, setShowVectorField] = useState(true);
  const [voltage, setVoltage] = useState<number | null>(null);
  const [mousePosition, setMousePosition] = useState<THREE.Vector3 | null>(null);
  const [charges, setCharges] = useState<Charge[]>(() => {
    const charge1 = createDefaultCharge('charge-1');
    charge1.position.set(0, 0, 0);
    charge1.magnitude = 1e-6;
    return [charge1];
  });
  const [chargeMeshes, setChargeMeshes] = useState<THREE.Mesh[]>([]);
  const [showCoordinateDialog, setShowCoordinateDialog] = useState(false);
  const [coordinateInputs, setCoordinateInputs] = useState({ x: '0', y: '0', z: '0' });
  const [voltageEntries, setVoltageEntries] = useState<Array<{ id: string; voltage: number; position: THREE.Vector3 }>>([]);
  const [addingCharge, setAddingCharge] = useState(false);
  const [voltageOrbs, setVoltageOrbs] = useState<THREE.Mesh[]>([]);
  const chargesRef = useRef<Charge[]>(charges);
  
  // Keep ref in sync with state
  useEffect(() => {
    chargesRef.current = charges;
  }, [charges]);

  // Update charge meshes when charges change
  useEffect(() => {
    // Remove old meshes (but don't dispose shared geometry/material)
    chargeMeshes.forEach(mesh => {
      scene.remove(mesh);
    });

    // Create new meshes
    const newMeshes: THREE.Mesh[] = [];
    charges.forEach((charge) => {
      const material = charge.magnitude > 0 ? positiveChargeMaterial : negativeChargeMaterial;
      const mesh = new THREE.Mesh(chargeGeometry, material);
      mesh.position.copy(charge.position);
      mesh.userData = { chargeId: charge.id };
      scene.add(mesh);
      newMeshes.push(mesh);
    });
    setChargeMeshes(newMeshes);

    // Update vector field
    if (vectorFieldRenderer) {
      vectorFieldRenderer.updateCharges(charges);
    }
  }, [charges, vectorFieldRenderer]);

  // Update voltage orbs when voltage entries change
  useEffect(() => {
    // Remove old orbs (but don't dispose shared geometry/material)
    voltageOrbs.forEach(orb => {
      scene.remove(orb);
    });

    // Create new orbs
    const newOrbs: THREE.Mesh[] = [];
    voltageEntries.forEach((entry) => {
      const orb = new THREE.Mesh(voltageOrbGeometry, voltageOrbMaterial);
      orb.position.copy(entry.position);
      orb.userData = { voltageEntryId: entry.id };
      scene.add(orb);
      newOrbs.push(orb);
    });
    setVoltageOrbs(newOrbs);
  }, [voltageEntries]);

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

    // Mouse tracking for voltage calculation
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // XY plane at y=0
    
    const onMouseMove = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(mouse, camera);
      const intersectionPoint = new THREE.Vector3();
      const result = raycaster.ray.intersectPlane(plane, intersectionPoint);
      
      if (result !== null) {
        setMousePosition(intersectionPoint.clone());
        const fieldResult = electricFieldAt(intersectionPoint, chargesRef.current);
        setVoltage(fieldResult.potential);
      }
    };

    renderer.domElement.addEventListener('mousemove', onMouseMove);

    // Click handlers
    const onClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(mouse, camera);
      const intersectionPoint = new THREE.Vector3();
      const result = raycaster.ray.intersectPlane(plane, intersectionPoint);
      
      if (result !== null) {
        if (addingCharge) {
          // Add charge mode
          const newCharge = createCharge(
            intersectionPoint.clone(),
            1e-6, // Default positive charge
            `charge-${Date.now()}`
          );
          setCharges(prev => [...prev, newCharge]);
          setAddingCharge(false);
        } else {
          // Open voltage coordinate dialog
          setCoordinateInputs({
            x: intersectionPoint.x.toFixed(2),
            y: intersectionPoint.y.toFixed(2),
            z: intersectionPoint.z.toFixed(2)
          });
          setShowCoordinateDialog(true);
        }
      }
    };

    renderer.domElement.addEventListener('click', onClick);

    animate();

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('click', onClick);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      if (vectorFieldRenderer) {
        vectorFieldRenderer.dispose();
      }
    };
  }, [addingCharge]);

  const toggleVectorField = () => {
    const newVisibility = !showVectorField;
    setShowVectorField(newVisibility);
    if (vectorFieldRenderer) {
      vectorFieldRenderer.setVisible(newVisibility);
    }
  };

  const handleCoordinateSubmit = () => {
    const x = parseFloat(coordinateInputs.x) || 0;
    const y = parseFloat(coordinateInputs.y) || 0;
    const z = parseFloat(coordinateInputs.z) || 0;
    const position = new THREE.Vector3(x, y, z);
    
    const result = electricFieldAt(position, chargesRef.current);
    const newEntry = {
      id: `voltage-${Date.now()}`,
      voltage: result.potential,
      position: position
    };
    setVoltageEntries(prev => [...prev, newEntry]);
    setShowCoordinateDialog(false);
  };

  const handleRemoveVoltageEntry = (id: string) => {
    setVoltageEntries(prev => prev.filter(entry => entry.id !== id));
  };

  const handleRemoveAllVoltageEntries = () => {
    setVoltageEntries([]);
  };

  const handleAddCharge = () => {
    setAddingCharge(prev => !prev);
  };

  const handleRemoveCharge = (chargeId: string) => {
    setCharges(prev => prev.filter(charge => charge.id !== chargeId));
  };

  const handleRemoveAllCharges = () => {
    setCharges([]);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#282c34' }} />
      
      {/* Simple control panel */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '10px',
        borderRadius: '5px',
        fontFamily: 'monospace',
        fontSize: '12px'
      }}>
        <div>Electric Field Visualizer</div>
        <div>Charges: {charges.length}</div>
        {addingCharge && (
          <div style={{ marginTop: '5px', padding: '5px', background: 'rgba(255, 193, 7, 0.3)', borderRadius: '3px', fontSize: '10px' }}>
            Click on scene to add charge
          </div>
        )}
        {voltage !== null && mousePosition && (
          <div style={{ marginTop: '5px' }}>
            <div>Voltage: {voltage.toExponential(2)} V</div>
            <div style={{ fontSize: '10px', color: '#aaa' }}>
              Position: ({mousePosition.x.toFixed(2)}, {mousePosition.y.toFixed(2)}, {mousePosition.z.toFixed(2)})
            </div>
          </div>
        )}
        <div style={{ marginTop: '10px', borderTop: '1px solid #444', paddingTop: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '5px' }}>Charge Management</div>
          <button 
            onClick={handleAddCharge}
            style={{
              marginTop: '5px',
              padding: '5px 10px',
              background: addingCharge ? '#ff9800' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              width: '100%',
              fontSize: '11px'
            }}
          >
            {addingCharge ? 'Cancel Add' : 'Add Charge'}
          </button>
          {charges.length > 0 && (
            <>
              <button 
                onClick={handleRemoveAllCharges}
                style={{
                  marginTop: '5px',
                  padding: '5px 10px',
                  background: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  width: '100%',
                  fontSize: '11px'
                }}
              >
                Remove All Charges
              </button>
              <div style={{ marginTop: '5px', maxHeight: '150px', overflowY: 'auto', fontSize: '10px' }}>
                {charges.map((charge) => (
                  <div key={charge.id} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '3px',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '3px',
                    marginTop: '3px'
                  }}>
                    <span>
                      {charge.magnitude > 0 ? '+' : ''}{charge.magnitude.toExponential(1)} C
                      <span style={{ color: '#aaa', marginLeft: '5px' }}>
                        ({charge.position.x.toFixed(1)}, {charge.position.y.toFixed(1)}, {charge.position.z.toFixed(1)})
                      </span>
                    </span>
                    <button
                      onClick={() => handleRemoveCharge(charge.id)}
                      style={{
                        padding: '2px 6px',
                        background: '#f44336',
                        color: 'white',
                        border: 'none',
                        borderRadius: '2px',
                        cursor: 'pointer',
                        fontSize: '9px'
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div style={{ marginTop: '10px', borderTop: '1px solid #444', paddingTop: '10px' }}>
          <div style={{ fontSize: '10px', color: '#aaa', marginBottom: '5px' }}>
            Click on scene to check voltage
          </div>
          <button 
            onClick={toggleVectorField}
            style={{
              marginTop: '5px',
              padding: '5px 10px',
              background: showVectorField ? '#4CAF50' : '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              width: '100%',
              fontSize: '11px'
            }}
          >
            {showVectorField ? 'Hide' : 'Show'} Vector Field
          </button>
        </div>
      </div>

      {/* Voltage Entries Panel - Top Right */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '10px',
        borderRadius: '5px',
        fontFamily: 'monospace',
        fontSize: '12px',
        minWidth: '300px',
        maxWidth: '400px'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>Voltage Entries</div>
        <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '10px' }}>
          Click on scene to add entry
        </div>
        <button 
          onClick={() => {
            setCoordinateInputs({ x: '0', y: '0', z: '0' });
            setShowCoordinateDialog(true);
          }}
          style={{
            marginBottom: '10px',
            padding: '5px 10px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            width: '100%',
            fontSize: '11px'
          }}
        >
          Add Entry
        </button>
        {voltageEntries.length > 0 && (
          <>
            <button 
              onClick={handleRemoveAllVoltageEntries}
              style={{
                marginBottom: '10px',
                padding: '5px 10px',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                width: '100%',
                fontSize: '11px'
              }}
            >
              Remove All
            </button>
            <div style={{ maxHeight: '400px', overflowY: 'auto', fontSize: '10px' }}>
              {voltageEntries.map((entry) => (
                <div key={entry.id} style={{ 
                  display: 'flex', 
                  flexDirection: 'column',
                  padding: '5px',
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: '3px',
                  marginBottom: '5px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>Voltage: {entry.voltage.toExponential(2)} V</div>
                      <div style={{ color: '#aaa', fontSize: '9px', marginTop: '2px' }}>
                        ({entry.position.x.toFixed(2)}, {entry.position.y.toFixed(2)}, {entry.position.z.toFixed(2)})
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveVoltageEntry(entry.id)}
                      style={{
                        padding: '3px 8px',
                        background: '#f44336',
                        color: 'white',
                        border: 'none',
                        borderRadius: '2px',
                        cursor: 'pointer',
                        fontSize: '9px'
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Coordinate Input Dialog - Top Right */}
      {showCoordinateDialog && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(0, 0, 0, 0.9)',
          color: 'white',
          padding: '20px',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '14px',
          zIndex: 1000,
          minWidth: '300px',
          border: '2px solid #444'
        }}>
          <div style={{ marginBottom: '15px', fontWeight: 'bold', fontSize: '16px' }}>
            Enter Coordinates
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>X:</label>
            <input
              type="number"
              value={coordinateInputs.x}
              onChange={(e) => setCoordinateInputs({ ...coordinateInputs, x: e.target.value })}
              style={{
                width: '100%',
                padding: '5px',
                background: '#333',
                color: 'white',
                border: '1px solid #555',
                borderRadius: '3px',
                fontSize: '14px'
              }}
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>Y:</label>
            <input
              type="number"
              value={coordinateInputs.y}
              onChange={(e) => setCoordinateInputs({ ...coordinateInputs, y: e.target.value })}
              style={{
                width: '100%',
                padding: '5px',
                background: '#333',
                color: 'white',
                border: '1px solid #555',
                borderRadius: '3px',
                fontSize: '14px'
              }}
            />
          </div>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>Z:</label>
            <input
              type="number"
              value={coordinateInputs.z}
              onChange={(e) => setCoordinateInputs({ ...coordinateInputs, z: e.target.value })}
              style={{
                width: '100%',
                padding: '5px',
                background: '#333',
                color: 'white',
                border: '1px solid #555',
                borderRadius: '3px',
                fontSize: '14px'
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleCoordinateSubmit}
              style={{
                flex: 1,
                padding: '8px',
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Calculate Voltage
            </button>
            <button
              onClick={() => setShowCoordinateDialog(false)}
              style={{
                flex: 1,
                padding: '8px',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ThreeWorkspace;