import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Module-level singleton scene. Kept outside React's lifecycle so StrictMode
 * double-invoke doesn't duplicate the WebGPU/WebGL context and OrbitControls.
 */
export class WorkspaceScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: WebGPURenderer | THREE.WebGLRenderer;
  private controls: OrbitControls | null = null;
  private rafId: number | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x282c34);
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      2000,
    );

    this.renderer = 'gpu' in navigator
      ? new WebGPURenderer({ antialias: true })
      : new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setClearColor(0x282c34, 1);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(0, 10, 5);
    this.scene.add(directional);

    this.scene.add(new THREE.AxesHelper(5));
    this.scene.add(new THREE.GridHelper(20, 20, 0x444444, 0x222222));
  }

  /** Mount the canvas into a DOM container. Returns a detach function. */
  attach(container: HTMLElement): () => void {
    if (!container.contains(this.renderer.domElement)) {
      container.appendChild(this.renderer.domElement);
    }

    this.camera.position.set(8, 8, 8);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    const onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    onResize();
    window.addEventListener('resize', onResize);

    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      this.controls?.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();

    return () => {
      window.removeEventListener('resize', onResize);
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.controls?.dispose();
      this.controls = null;
      if (container.contains(this.renderer.domElement)) {
        container.removeChild(this.renderer.domElement);
      }
    };
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement as HTMLCanvasElement;
  }

  /** Whether attach() has set up controls. Click handlers should bail when null. */
  get hasControls(): boolean {
    return this.controls !== null;
  }
}

export const workspaceScene = new WorkspaceScene();
