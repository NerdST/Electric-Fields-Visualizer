/**
 * Visualizes E field data from the 3D FDTD simulation as instanced arrows.
 *
 * Unlike the Coulomb VectorField renderer (which computes fields analytically),
 * this reads directly from the FDTD grid arrays each frame.
 * It maps grid indices to world-space positions so the arrows sit on the
 * Three.js grid in a natural way.
 */
import * as THREE from 'three';

/** Common interface for both CPU and GPU FDTD simulations */
export interface FDTDSimulationReader {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  getFieldMagnitudeAt(i: number, j: number, k: number): number;
  getFieldAt(i: number, j: number, k: number): [number, number, number];
}

export class FDTDVectorFieldRenderer {
  private scene: THREE.Scene;
  private arrowMesh: THREE.InstancedMesh | null = null;
  private arrowGeometry: THREE.ConeGeometry;
  private arrowMaterial: THREE.MeshBasicMaterial;
  private simulation: FDTDSimulationReader;

  // Mapping: how FDTD grid maps to world space
  // Grid center sits at world origin, each cell = dx in world units scaled up
  private worldScale: number;  // world units per grid cell
  private originOffset: THREE.Vector3; // world position of grid cell (0,0,0)

  private readonly upVector = new THREE.Vector3(0, 1, 0);

  // We only visualize every Nth cell to keep arrow count manageable
  private stride: number;
  private visibleIndices: { i: number; j: number; k: number }[] = [];

  constructor(scene: THREE.Scene, simulation: FDTDSimulationReader, worldScale: number = 0.3, stride: number = 2) {
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
    // Use vertex colors so each arrow can show field strength via color
    this.arrowMaterial = new THREE.MeshBasicMaterial({
      vertexColors: false,
      transparent: true,
      opacity: 0.9,
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

  // Track peak field magnitude across all frames so scaling is stable
  private peakMagnitude: number = 0;

  /**
   * Read the current FDTD state and update all arrow transforms.
   * Call this every frame while the simulation is running.
   *
   * Uses a running peak magnitude for stable scaling — arrows that haven't
   * been reached by the wavefront yet stay invisible (scale 0), and the
   * wavefront is visible as a shell of arrows expanding outward.
   * Color encodes field strength: blue (weak) → green → yellow → red (strong).
   */
  public update(): void {
    if (!this.arrowMesh || !this.arrowMesh.visible) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const direction = new THREE.Vector3();
    const color = new THREE.Color();

    // Ensure instance color buffer exists
    if (!this.arrowMesh.instanceColor) {
      const colors = new Float32Array(this.visibleIndices.length * 3);
      this.arrowMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      // Need to enable per-instance colors on the material
      this.arrowMaterial.vertexColors = true;
      this.arrowMaterial.needsUpdate = true;
    }

    // Find this frame's max to update the running peak
    let framePeak = 0;
    for (const { i, j, k } of this.visibleIndices) {
      const mag = this.simulation.getFieldMagnitudeAt(i, j, k);
      if (mag > framePeak) framePeak = mag;
    }

    // Use running peak for stable scaling (slowly decay to adapt if source changes)
    if (framePeak > this.peakMagnitude) {
      this.peakMagnitude = framePeak;
    } else {
      // Slow decay so scale adapts over time (0.1% per frame)
      this.peakMagnitude *= 0.999;
    }
    const refMag = Math.max(this.peakMagnitude, 1e-20);

    // Threshold: arrows below 0.5% of peak are hidden (wavefront hasn't arrived)
    const visibilityThreshold = refMag * 0.005;

    for (let n = 0; n < this.visibleIndices.length; n++) {
      const { i, j, k } = this.visibleIndices[n];
      const [ex, ey, ez] = this.simulation.getFieldAt(i, j, k);
      const mag = Math.sqrt(ex * ex + ey * ey + ez * ez);

      if (mag < visibilityThreshold) {
        // Below threshold: hide this arrow
        matrix.makeScale(0, 0, 0);
        this.arrowMesh.setMatrixAt(n, matrix);
        color.setRGB(0, 0, 0);
        this.arrowMesh.setColorAt(n, color);
        continue;
      }

      // World position of this grid cell
      position.set(
        this.originOffset.x + i * this.worldScale,
        this.originOffset.y + j * this.worldScale,
        this.originOffset.z + k * this.worldScale,
      );

      // Scale relative to running peak — gives stable arrow sizes
      const normalizedMag = Math.min(mag / refMag, 1.0);
      const arrowLength = 0.05 + normalizedMag * 0.25;
      scale.set(1, arrowLength, 1);

      // Orient arrow along field direction
      direction.set(ex, ey, ez).normalize();
      quaternion.setFromUnitVectors(this.upVector, direction);

      matrix.compose(position, quaternion, scale);
      this.arrowMesh.setMatrixAt(n, matrix);

      // Color by field strength: blue → cyan → green → yellow → red
      const t = normalizedMag;
      if (t < 0.25) {
        color.setRGB(0, t * 4, 1);            // blue → cyan
      } else if (t < 0.5) {
        color.setRGB(0, 1, 1 - (t - 0.25) * 4); // cyan → green
      } else if (t < 0.75) {
        color.setRGB((t - 0.5) * 4, 1, 0);    // green → yellow
      } else {
        color.setRGB(1, 1 - (t - 0.75) * 4, 0); // yellow → red
      }
      this.arrowMesh.setColorAt(n, color);
    }

    this.arrowMesh.instanceMatrix.needsUpdate = true;
    if (this.arrowMesh.instanceColor) {
      (this.arrowMesh.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  /** Reset peak tracking (call when simulation resets) */
  public resetPeak(): void {
    this.peakMagnitude = 0;
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
