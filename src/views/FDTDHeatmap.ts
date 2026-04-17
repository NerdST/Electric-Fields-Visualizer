/**
 * Visualizes FDTD E field as a 3D heatmap point cloud.
 *
 * Instead of arrows (which "spin" due to oscillating field direction),
 * this shows field MAGNITUDE and POLARITY as colored dots — the 3D
 * equivalent of the 2D ripple visualization.
 *
 * Color scheme (matches 2D version):
 *   - Orange/red  = positive Ez
 *   - Blue        = negative Ez
 *   - Brightness  = field magnitude (exponential mapping)
 *   - Transparent  = no field yet (wavefront hasn't arrived)
 */
import * as THREE from 'three';
import type { FDTDSimulationReader } from './FDTDVectorField';

export class FDTDHeatmapRenderer {
  private scene: THREE.Scene;
  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private simulation: FDTDSimulationReader;

  private worldScale: number;
  private originOffset: THREE.Vector3;
  private stride: number;

  // Precomputed grid indices we visualize
  private visibleCells: { i: number; j: number; k: number }[] = [];

  // Running peak for stable brightness scaling
  private peakMagnitude: number = 0;

  // Brightness gain — controls how sensitive the color mapping is
  private gain: number = 12.0;

  constructor(
    scene: THREE.Scene,
    simulation: FDTDSimulationReader,
    worldScale: number = 0.3,
    stride: number = 1,  // stride=1 for dense heatmap (every cell)
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

    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.PointsMaterial({
      size: 8,  // size in pixels (sizeAttenuation off)
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: false,  // fixed pixel size regardless of camera distance
      depthWrite: false,
    });

    this.buildVisibleCells();
    this.createPoints();
  }

  private buildVisibleCells(): void {
    this.visibleCells = [];
    const { nx, ny, nz } = this.simulation;
    // Skip boundary cells (always zero from PEC BCs)
    for (let k = 1; k < nz - 1; k += this.stride) {
      for (let j = 1; j < ny - 1; j += this.stride) {
        for (let i = 1; i < nx - 1; i += this.stride) {
          this.visibleCells.push({ i, j, k });
        }
      }
    }
  }

  private createPoints(): void {
    const count = this.visibleCells.length;
    if (count === 0) return;

    // Static positions — these don't change
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);  // RGB per vertex

    for (let n = 0; n < count; n++) {
      const { i, j, k } = this.visibleCells[n];
      positions[n * 3]     = this.originOffset.x + i * this.worldScale;
      positions[n * 3 + 1] = this.originOffset.y + j * this.worldScale;
      positions[n * 3 + 2] = this.originOffset.z + k * this.worldScale;

      // Start black (invisible on dark background)
      colors[n * 3] = 0;
      colors[n * 3 + 1] = 0;
      colors[n * 3 + 2] = 0;
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Must compute bounding sphere or Three.js frustum-culls the entire point cloud
    this.geometry.computeBoundingSphere();

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;  // extra safety — never cull this
    this.points.visible = false;  // hidden until user enables
    this.scene.add(this.points);
  }

  /**
   * Update colors and sizes from current FDTD state.
   * Call every frame while simulation runs.
   *
   * Uses the same color scheme as the 2D version:
   *   positive Ez → orange/red,  negative Ez → blue
   *   brightness = 1 - exp(-|Ez| * gain)
   */
  public update(): void {
    if (!this.points || !this.points.visible) return;

    const colorAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const colors = colorAttr.array as Float32Array;

    // Colors matching the 2D shader
    const posR = 1.0, posG = 0.28, posB = 0.05;  // orange/red for positive
    const negR = 0.10, negG = 0.45, negB = 1.0;   // blue for negative

    // Find frame peak for adaptive gain
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

    // Adaptive gain: auto-scale so the peak field maps to ~0.8 brightness
    const adaptiveGain = this.peakMagnitude > 1e-20
      ? 1.6 / this.peakMagnitude
      : this.gain;

    for (let n = 0; n < this.visibleCells.length; n++) {
      const { i, j, k } = this.visibleCells[n];
      const [ex, ey, ez] = this.simulation.getFieldAt(i, j, k);
      const mag = Math.sqrt(ex * ex + ey * ey + ez * ez);

      // Exponential mapping (same as 2D shader): brightness = 1 - exp(-mag * gain)
      const vis = 1.0 - Math.exp(-mag * adaptiveGain);

      if (vis < 0.01) {
        // Below threshold — invisible
        colors[n * 3]     = 0;
        colors[n * 3 + 1] = 0;
        colors[n * 3 + 2] = 0;
        continue;
      }

      // Use Ez polarity for color (dominant component for z-polarized sources)
      // For general sources, use the dominant component
      const dominant = Math.abs(ex) > Math.abs(ey)
        ? (Math.abs(ex) > Math.abs(ez) ? ex : ez)
        : (Math.abs(ey) > Math.abs(ez) ? ey : ez);

      if (dominant >= 0) {
        colors[n * 3]     = posR * vis;
        colors[n * 3 + 1] = posG * vis;
        colors[n * 3 + 2] = posB * vis;
      } else {
        colors[n * 3]     = negR * vis;
        colors[n * 3 + 1] = negG * vis;
        colors[n * 3 + 2] = negB * vis;
      }
    }

    colorAttr.needsUpdate = true;
  }

  public resetPeak(): void {
    this.peakMagnitude = 0;
  }

  public setVisible(visible: boolean): void {
    if (this.points) {
      this.points.visible = visible;
    }
  }

  public isVisible(): boolean {
    return this.points?.visible ?? false;
  }

  public dispose(): void {
    if (this.points) {
      this.scene.remove(this.points);
    }
    this.geometry.dispose();
    this.material.dispose();
  }
}
