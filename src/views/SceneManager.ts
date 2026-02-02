import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WebGPURenderer } from 'three/webgpu';

export class SceneManager {
  public renderer: WebGPURenderer | THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public controls: OrbitControls | null = null;

  constructor() {
    // Initialize renderer
    if ('gpu' in navigator) {
      this.renderer = new WebGPURenderer({ antialias: true });
    } else {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    }
    this.renderer.setClearColor(0x282c34, 1);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Initialize scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x282c34);

    // Initialize camera
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0, 10, 5);
    this.scene.add(directionalLight);

    // Add helpers
    const axesHelper = new THREE.AxesHelper(5);
    this.scene.add(axesHelper);
    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    this.scene.add(gridHelper);
  }

  public initializeControls(domElement: HTMLElement): void {
    this.camera.position.set(8, 8, 8);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public render(): void {
    if (this.controls) {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    // Cleanup will be handled by individual managers
  }
}

