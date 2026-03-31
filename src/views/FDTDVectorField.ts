/**
 * Visualizes E field data from the 3D FDTD simulation as instanced arrows.
 *
 * Unlike the Coulomb VectorField renderer (which computes fields analytically),
 * this reads directly from the FDTD grid arrays each frame.
 * It maps grid indices to world-space positions so the arrows sit on the
 * Three.js grid in a natural way.
 */
import * as THREE from 'three';
import type { FDTDSimulation3D } from '../simulation/FDTDSimulation3D';

export class FDTDVectorFieldRenderer {
  private scene: THREE.Scene;
  private arrowMesh: THREE.InstancedMesh | null = null;
  private arrowGeometry: THREE.ConeGeometry;
  private arrowMaterial: THREE.MeshBasicMaterial;
  private simulation: FDTDSimulation3D;

  // Mapping: how FDTD grid maps to world space
  // Grid center sits at world origin, each cell = dx in world units scaled up
  private worldScale: number;  // world units per grid cell
  private originOffset: THREE.Vector3; // world position of grid cell (0,0,0)

  private readonly upVector = new THREE.Vector3(0, 1, 0);

  // We only visualize every Nth cell to keep arrow count manageable
  private stride: number;
  private visibleIndices: { i: number; j: number; k: number }[] = [];

  constructor(scene: THREE.Scene, simulation: FDTDSimulation3D, worldScale: number = 0.3, stride: number = 2) {
    this.scene = scene;
    this.simulation = simulation;
    this.worldScale = worldScale;
    this.stride = stride;

    // Center the grid at the world origin
    this.originOffset = new THREE.Vector3(
      -(simulation.nx * worldScale) / 2,
      -(simulation.ny * worldScale) / 2,
      -(simulation.nz * worldScale) / 2,
    );

    this.arrowGeometry = new THREE.ConeGeometry(0.04, 0.15, 6);
    this.arrowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.8,
    });

    this.buildVisibleIndices();
    this.createMesh();
  }

  /** Precompute which grid cells we'll visualize */
  private buildVisibleIndices(): void {
    this.visibleIndices = [];
    const { nx, ny, nz } = this.simulation;
    // Skip boundary cells (they're always zero from BCs)
    for (let k = 1; k < nz - 1; k += this.stride) {
      for (let j = 1; j < ny - 1; j += this.stride) {
        for (let i = 1; i < nx - 1; i += this.stride) {
          this.visibleIndices.push({ i, j, k });
        }
      }
    }
  }

  private createMesh(): void {
    if (this.arrowMesh) {
      this.scene.remove(this.arrowMesh);
      this.arrowMesh.dispose();
    }

    const count = this.visibleIndices.length;
    if (count === 0) return;

    this.arrowMesh = new THREE.InstancedMesh(
      this.arrowGeometry,
      this.arrowMaterial,
      count,
    );
    this.arrowMesh.visible = false; // Start hidden until user enables FDTD mode
    this.scene.add(this.arrowMesh);
  }

  /**
   * Read the current FDTD state and update all arrow transforms.
   * Call this every frame while the simulation is running.
   */
  public update(): void {
    if (!this.arrowMesh || !this.arrowMesh.visible) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const direction = new THREE.Vector3();

    // Find the max field magnitude this frame for normalization
    let maxMag = 0;
    for (const { i, j, k } of this.visibleIndices) {
      const mag = this.simulation.getFieldMagnitudeAt(i, j, k);
      if (mag > maxMag) maxMag = mag;
    }
    // Avoid division by zero
    if (maxMag < 1e-20) maxMag = 1e-20;

    for (let n = 0; n < this.visibleIndices.length; n++) {
      const { i, j, k } = this.visibleIndices[n];
      const [ex, ey, ez] = this.simulation.getFieldAt(i, j, k);
      const mag = Math.sqrt(ex * ex + ey * ey + ez * ez);

      if (mag < 1e-20) {
        matrix.makeScale(0, 0, 0);
        this.arrowMesh.setMatrixAt(n, matrix);
        continue;
      }

      // World position of this grid cell
      position.set(
        this.originOffset.x + i * this.worldScale,
        this.originOffset.y + j * this.worldScale,
        this.originOffset.z + k * this.worldScale,
      );

      // Normalize arrow length relative to current max
      const normalizedMag = mag / maxMag;
      const arrowLength = Math.max(normalizedMag * 0.3, 0.05);
      scale.set(1, arrowLength, 1);

      // Orient arrow along field direction
      direction.set(ex, ey, ez).normalize();
      quaternion.setFromUnitVectors(this.upVector, direction);

      matrix.compose(position, quaternion, scale);
      this.arrowMesh.setMatrixAt(n, matrix);
    }

    this.arrowMesh.instanceMatrix.needsUpdate = true;
  }

  public setVisible(visible: boolean): void {
    if (this.arrowMesh) {
      this.arrowMesh.visible = visible;
    }
  }

  public isVisible(): boolean {
    return this.arrowMesh?.visible ?? false;
  }

  public dispose(): void {
    if (this.arrowMesh) {
      this.scene.remove(this.arrowMesh);
      this.arrowMesh.dispose();
    }
    this.arrowGeometry.dispose();
    this.arrowMaterial.dispose();
  }
}
