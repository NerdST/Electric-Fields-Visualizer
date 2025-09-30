import React, { useRef, useEffect, useState } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createDefaultCharge } from '../physics/Charge';
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

const charges: Charge[] = [charge1]; //[charge1, charge2];

// Create charge visualizations
const chargeMeshes: THREE.Mesh[] = [];
charges.forEach((charge) => {
  const material = charge.magnitude > 0 ? positiveChargeMaterial : negativeChargeMaterial;
  const mesh = new THREE.Mesh(chargeGeometry, material);
  mesh.position.copy(charge.position);
  mesh.userData = { chargeId: charge.id };
  scene.add(mesh);
  chargeMeshes.push(mesh);
});

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  renderer.render(scene, camera);
}

const ThreeWorkspace: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vectorFieldRenderer, setVectorFieldRenderer] = useState<VectorFieldRenderer | null>(null);
  const [showVectorField, setShowVectorField] = useState(true);

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

    animate();

    return () => {
      window.removeEventListener('resize', onResize);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      if (vectorFieldRenderer) {
        vectorFieldRenderer.dispose();
      }
    };
  }, []);

  const toggleVectorField = () => {
    setShowVectorField(!showVectorField);
    if (vectorFieldRenderer) {
      vectorFieldRenderer.setVisible(!showVectorField);
    }
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
        <button 
          onClick={toggleVectorField}
          style={{
            marginTop: '5px',
            padding: '5px 10px',
            background: showVectorField ? '#4CAF50' : '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer'
          }}
        >
          {showVectorField ? 'Hide' : 'Show'} Vector Field
        </button>
      </div>
    </div>
  );
};

export default ThreeWorkspace;