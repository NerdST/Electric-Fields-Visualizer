/**
 * Visualizes FDTD E field as a 3D heatmap using instanced cubes.
 *
 * Instead of arrows (which "spin" due to oscillating field direction),
 * this shows field MAGNITUDE and POLARITY as colored cubes — the 3D
 * equivalent of the 2D ripple visualization.
 *
 * Color scheme (matches 2D version):
 *   - Orange/red  = positive field
 *   - Blue        = negative field
 *   - Scale/brightness = field magnitude
 *   - Scale 0     = no field yet (wavefront hasn't arrived)
 *
 * Uses InstancedMesh (same as the arrow renderer that worked).
 */
import * as THREE from 'three';
import type { FDTDSimulationReader } from './FDTDVectorField';

export class FDTDHeatmapRenderer {
  private scene: THREE.Scene;
  private mesh: THREE.InstancedMesh | null = null;
  private cubeGeometry: THREE.BoxGeometry;
  private cubeMaterial: THREE.MeshBasicMaterial;
  private simulation: FDTDSimulationReader;

  private worldScale: number;
  private originOffset: THREE.Vector3;
  private stride: number;

  private visibleCells: { i: number; j: number; k: number }[] = [];
  private peakMagnitude: number = 0;

  constructor(
    scene: THREE.Scene,
    simulation: FDTDSimulationReader,
    worldScale: number = 0.3,
    stride: number = 2,
  ) {
    this.scene = scene;
    this.simulation = simulation;
    this.worldScale = worldScale;
    this.stride = stride;

    this.originOffset = new THREE.Vector3(
      -(simulation.nx * worldScale) / 2,
      -(simulation.ny * worldScale) / 2,
      -(simulation.nz * worldScale) / 2,
    );

    // Small cube for each grid cell
    const cubeSize = worldScale * stride * 0.7;
    this.cubeGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    this.cubeMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.85,
    });

    this.buildVisibleCells();
    this.createMesh();
  }

  private buildVisibleCells(): void {
    this.visibleCells = [];
    const { nx, ny, nz } = this.simulation;
    for (let k = 1; k < nz - 1; k += this.stride) {
      for (let j = 1; j < ny - 1; j += this.stride) {
        for (let i = 1; i < nx - 1; i += this.stride) {
          this.visibleCells.push({ i, j, k });
        }
      }
    }
  }

  private createMesh(): void {
    const count = this.visibleCells.length;
    if (count === 0) return;

    this.mesh = new THREE.InstancedMesh(
      this.cubeGeometry,
      this.cubeMaterial,
      count,
    );
    this.mesh.visible = false;

    // Initialize: place each cube at its grid position, scale to 0 (hidden)
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const zeroScale = new THREE.Vector3(0, 0, 0);
    const noRotation = new THREE.Quaternion();

    for (let n = 0; n < count; n++) {
      const { i, j, k } = this.visibleCells[n];
      position.set(
        this.originOffset.x + i * this.worldScale,
        this.originOffset.y + j * this.worldScale,
        this.originOffset.z + k * this.worldScale,
      );
      matrix.compose(position, noRotation, zeroScale);
      this.mesh.setMatrixAt(n, matrix);
      this.mesh.setColorAt(n, new THREE.Color(0, 0, 0));
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      (this.mesh.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    }

    this.scene.add(this.mesh);
  }

  /**
   * Read current FDTD state and update cube scales and colors.
   *
   * Cubes where field hasn't arrived yet are scale=0 (invisible).
   * Where field exists: size = field magnitude, color = polarity.
   */
  public update(): void {
    if (!this.mesh || !this.mesh.visible) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const noRotation = new THREE.Quaternion();
    const color = new THREE.Color();

    // Ensure instance color buffer exists
    if (!this.mesh.instanceColor) {
      const colors = new Float32Array(this.visibleCells.length * 3);
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      this.cubeMaterial.vertexColors = true;
      this.cubeMaterial.needsUpdate = true;
    }

    // Find frame peak
    let framePeak = 0;
    for (const { i, j, k } of this.visibleCells) {
      const mag = this.simulation.getFieldMagnitudeAt(i, j, k);
      if (mag > framePeak) framePeak = mag;
    }

    if (framePeak > this.peakMagnitude) {
      this.peakMagnitude = framePeak;
    } else {
      this.peakMagnitude *= 0.999;
    }
    const refMag = Math.max(this.peakMagnitude, 1e-20);
    const threshold = refMag * 0.005;

    // Colors matching the 2D shader
    const posColor = new THREE.Color(1.0, 0.28, 0.05);   // orange/red
    const negColor = new THREE.Color(0.10, 0.45, 1.0);    // blue

    for (let n = 0; n < this.visibleCells.length; n++) {
      const { i, j, k } = this.visibleCells[n];
      const [ex, ey, ez] = this.simulation.getFieldAt(i, j, k);
      const mag = Math.sqrt(ex * ex + ey * ey + ez * ez);

      // Position (constant)
      position.set(
        this.originOffset.x + i * this.worldScale,
        this.originOffset.y + j * this.worldScale,
        this.originOffset.z + k * this.worldScale,
      );

      if (mag < threshold) {
        // Not yet reached by wave — hide
        matrix.compose(position, noRotation, new THREE.Vector3(0, 0, 0));
        this.mesh.setMatrixAt(n, matrix);
        color.setRGB(0, 0, 0);
        this.mesh.setColorAt(n, color);
        continue;
      }

      // Scale cube by normalized magnitude (0 to 1)
      const t = Math.min(mag / refMag, 1.0);
      const s = 0.3 + t * 0.7;  // scale from 0.3 to 1.0
      scale.set(s, s, s);
      matrix.compose(position, noRotation, scale);
      this.mesh.setMatrixAt(n, matrix);

      // Color by polarity of dominant field component
      const dominant = Math.abs(ex) > Math.abs(ey)
        ? (Math.abs(ex) > Math.abs(ez) ? ex : ez)
        : (Math.abs(ey) > Math.abs(ez) ? ey : ez);

      if (dominant >= 0) {
        color.copy(posColor).multiplyScalar(0.3 + t * 0.7);
      } else {
        color.copy(negColor).multiplyScalar(0.3 + t * 0.7);
      }
      this.mesh.setColorAt(n, color);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      (this.mesh.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  public resetPeak(): void {
    this.peakMagnitude = 0;
  }

  public setVisible(visible: boolean): void {
    if (this.mesh) {
      this.mesh.visible = visible;
    }
  }

  public isVisible(): boolean {
    return this.mesh?.visible ?? false;
  }

  public dispose(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    this.cubeGeometry.dispose();
    this.cubeMaterial.dispose();
  }
}
