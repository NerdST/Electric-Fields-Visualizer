import React, { useRef, useEffect } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

const ThreeWorkspace: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Ensure this only runs in the browser
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    // Renderer
    const renderer: WebGPURenderer | THREE.WebGLRenderer = (typeof navigator !== 'undefined' && 'gpu' in navigator)
      ? new WebGPURenderer({ antialias: true })
      : new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(0x282c34, 1);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

    // Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x282c34);
    const camera = new THREE.PerspectiveCamera(70, (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight), 0.1, 2000);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0, 10, 5);
    scene.add(directionalLight);

    // Helpers
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);
    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    (scene as any).add(gridHelper);

    // Mesh
    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: 'hotpink' });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.set(0, 1, 0);
    scene.add(sphere);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Camera initial position
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);

    // Mount canvas
    if (!container.contains(renderer.domElement)) {
      container.appendChild(renderer.domElement);
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

    let isDisposed = false;
    const animate = () => {
      if (isDisposed) return;
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      isDisposed = true;
      window.removeEventListener('resize', onResize);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      // Dispose resources
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', background: '#282c34' }} />
  );
};

export default ThreeWorkspace;