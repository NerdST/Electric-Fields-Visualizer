// const Scene: React.FC = () => {
//   const { scene } = useThree();
//   const sphereRef = useRef<THREE.Mesh>(null);

//   useEffect(() => {
//     // Ambient light
//     const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
//     scene.add(ambientLight);

//     // Directional light
//     const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
//     directionalLight.position.set(0, 10, 5);
//     scene.add(directionalLight);

//     // Sphere
//     const geometry = new THREE.SphereGeometry(1, 32, 32);
//     const material = new THREE.MeshStandardMaterial({ color: 'hotpink' });
//     const sphere = new THREE.Mesh(geometry, material);
//     sphere.position.set(0, 0, 0);
//     scene.add(sphere);

//     // Cleanup
//     return () => {
//       scene.remove(ambientLight);
//       scene.remove(directionalLight);
//       scene.remove(sphere);
//       geometry.dispose();
//       material.dispose();
//     };
//   }, [scene]);

//   return <OrbitControls />;
// };

// const ThreeWorkspace: React.FC = () => (
//   <Canvas>
//     <Scene />
//   </Canvas>
// );

// export default ThreeWorkspace;

import React, { useRef, useEffect } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu'; // Note the path for WebGPURenderer

// import { WebGPURenderer } from 'three/examples/jsm/renderers/WebGPURenderer.js';

let renderer: WebGPURenderer | THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let animationId: number;

// Check if we're in a browser environment
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && typeof navigator !== 'undefined';
}

// Initialize WebGPU renderer asynchronously
async function initializeWebGPU(): Promise<void> {
  // Ensure we're in a browser environment
  if (!isBrowser()) {
    throw new Error('WebGPU initialization requires a browser environment');
  }

  if ('gpu' in navigator) {
    try {
      renderer = new WebGPURenderer({ antialias: true });
      console.log('WebGPU is supported in this browser. Using WebGPURenderer.');

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        console.error('WebGPU adapter not found. Falling back to WebGLRenderer.');
        renderer = new THREE.WebGLRenderer({ antialias: true });
      } else {
        await adapter.requestDevice();
        console.log('WebGPU device initialized successfully');
      }
    } catch (error) {
      console.error('WebGPU initialization failed, falling back to WebGL:', error);
      renderer = new THREE.WebGLRenderer({ antialias: true });
    }
  } else {
    console.warn('WebGPU is not supported in this browser. Falling back to WebGLRenderer.');
    renderer = new THREE.WebGLRenderer({ antialias: true });
  }

  // Setup renderer
  renderer.setClearColor(0x282c34, 1);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Setup scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x282c34);

  // Setup camera
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 5, 0);

  // Setup controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.update();

  // Setup lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(0, 10, 5);
  scene.add(directionalLight);

  // Setup geometry
  const geometry = new THREE.SphereGeometry(1, 32, 32);
  const material = new THREE.MeshStandardMaterial({ color: 'hotpink' });
  const sphere = new THREE.Mesh(geometry, material);
  sphere.position.set(0, 0, 0);
  scene.add(sphere);
}

function animate() {
  animationId = requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

const ThreeWorkspace: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if we're in a browser environment
    if (!isBrowser()) {
      console.warn('ThreeWorkspace: Not in a browser environment, skipping WebGPU initialization');
      return;
    }

    const container = canvasRef.current;
    if (!container) return;

    // Initialize WebGPU and setup the scene
    initializeWebGPU().then(() => {
      if (container && renderer && !container.contains(renderer.domElement)) {
        container.appendChild(renderer.domElement);
        animate();
      }
    }).catch((error) => {
      console.error('Failed to initialize WebGPU:', error);
    });

    // Cleanup on unmount
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (container && renderer?.domElement && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={canvasRef}
      style={{ width: '100vw', height: '100vh', background: '#282c34' }}
    />
  );
};
export default ThreeWorkspace;