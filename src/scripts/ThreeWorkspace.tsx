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
import { Canvas, useThree } from '@react-three/fiber';
// import { OrbitControls } from '@react-three/drei';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu'; // Note the path for WebGPURenderer

// import { WebGPURenderer } from 'three/examples/jsm/renderers/WebGPURenderer.js';

let renderer: WebGPURenderer | THREE.WebGLRenderer;

// Conditional renderer
if ('gpu' in navigator) {
  renderer = new WebGPURenderer({ antialias: true });
  console.log('WebGPU is supported in this browser. Using WebGPURenderer.');

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    console.error('WebGPU adapter not found. Falling back to WebGLRenderer.');
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } else {
    const device = await adapter.requestDevice();
  }
} else {  // Fallback to WebGL
  console.warn('WebGPU is not supported in this browser. Falling back to WebGLRenderer.');
  renderer = new THREE.WebGLRenderer({ antialias: true });
}
renderer.setClearColor(0x282c34, 1);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x282c34); // Dark background similar to the

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // an animation loop is required when either damping or auto-

camera.position.set(0, 5, 0);
controls.update();
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(0, 10, 5);
scene.add(directionalLight);
const geometry = new THREE.SphereGeometry(1, 32, 32);
const material = new THREE.MeshStandardMaterial({ color: 'hotpink' });
const sphere = new THREE.Mesh(geometry, material);
sphere.position.set(0, 0, 0);
scene.add(sphere);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

const ThreeWorkspace: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = canvasRef.current;
    if (container && !container.contains(renderer.domElement)) {
      container.appendChild(renderer.domElement);
      animate();
    }
    // Optionally cleanup on unmount
    return () => {
      if (container && renderer.domElement.parentNode === container) {
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