/**
 * 3D FDTD (Finite-Difference Time-Domain) Simulation
 *
 * Solves Maxwell's curl equations on a 3D Yee grid using normalized units
 * (matching Sangeeth's 2D implementation):
 *
 *   ∂H/∂t = -∇×E        (Faraday's law, μ=1)
 *   ∂E/∂t =  ∇×H + J    (Ampère's law, ε=1, with source current J)
 *
 * Charges are represented as a persistent source field that continuously
 * injects energy into E each timestep: E += dt * sourceField.
 * This creates expanding wavefronts from each charge — like ripples in water.
 */

export interface FDTDConfig {
  /** Number of cells in each dimension */
  nx: number;
  ny: number;
  nz: number;
  /** Cell size (normalized units) */
  dx: number;
  /** Time step (normalized units) */
  dt: number;
}

export interface FieldSource {
  ix: number;
  iy: number;
  iz: number;
  frequency: number;
  amplitude: number;
  polarization: 'x' | 'y' | 'z';
  type?: 'continuous' | 'pulse' | 'impulse';
  pulseWidth?: number;
}

export function createDefaultFDTDConfig(): FDTDConfig {
  return {
    nx: 96,
    ny: 96,
    nz: 96,
    dx: 0.01,     // cell size (normalized)
    dt: 0.001,    // time step (normalized, same as Sangeeth's 2D)
  };
}

export class FDTDSimulation3D {
  public readonly nx: number;
  public readonly ny: number;
  public readonly nz: number;
  private readonly totalCells: number;

  public readonly dx: number;
  public readonly dt: number;

  // Update coefficients (normalized: μ=1, ε=1, σ=0)
  // beta = dt / dx (curl coefficient)
  private readonly beta: number;

  // Field arrays
  public Ex: Float32Array;
  public Ey: Float32Array;
  public Ez: Float32Array;
  public Hx: Float32Array;
  public Hy: Float32Array;
  public Hz: Float32Array;

  // Persistent source field — charges live here.
  // Each step: E += dt * sourceField (continuous injection)
  private sourceEz: Float32Array;

  // Legacy sources (kept for API compatibility)
  private sources: FieldSource[] = [];

  private stepCount: number = 0;
  private currentTime: number = 0;

  constructor(config: FDTDConfig) {
    this.nx = config.nx;
    this.ny = config.ny;
    this.nz = config.nz;
    this.totalCells = config.nx * config.ny * config.nz;

    this.dx = config.dx;
    this.dt = config.dt;

    // Normalized update coefficient: beta = dt / dx
    // For Sangeeth's values: 0.001 / 0.01 = 0.1
    this.beta = this.dt / this.dx;

    this.Ex = new Float32Array(this.totalCells);
    this.Ey = new Float32Array(this.totalCells);
    this.Ez = new Float32Array(this.totalCells);
    this.Hx = new Float32Array(this.totalCells);
    this.Hy = new Float32Array(this.totalCells);
    this.Hz = new Float32Array(this.totalCells);

    this.sourceEz = new Float32Array(this.totalCells);
  }

  public idx(i: number, j: number, k: number): number {
    return i + j * this.nx + k * this.nx * this.ny;
  }

  /** Add a legacy oscillating source */
  public addSource(source: FieldSource): void {
    this.sources.push(source);
  }

  /** Remove all legacy sources */
  public clearSources(): void {
    this.sources = [];
  }

  /**
   * Inject a charge into the persistent source field.
   * This charge will continuously pump energy into E each timestep,
   * creating an expanding wavefront — exactly like Sangeeth's 2D version.
   */
  public injectImpulse(ix: number, iy: number, iz: number, amplitude: number): void {
    const idx = this.idx(ix, iy, iz);
    this.sourceEz[idx] += amplitude;
  }

  /** Clear the persistent source field (remove all charges) */
  public clearSourceField(): void {
    this.sourceEz.fill(0);
  }

  public getStepCount(): number {
    return this.stepCount;
  }

  public getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Advance one timestep. Order (matching Sangeeth's 2D):
   *   1. Inject sources: E += dt * sourceField
   *   2. Update E using curl(H)
   *   3. Update H using curl(E)
   *   4. Apply absorbing boundary
   */
  public step(): void {
    this.injectSourceField();
    this.updateE();
    this.updateH();
    this.applyBoundaryConditions();

    this.stepCount++;
    this.currentTime += this.dt;
  }

  /**
   * Inject persistent source field into E.
   * E += dt * sourceField
   * This is how charges continuously radiate — same as Sangeeth's injectSource.wgsl
   */
  private injectSourceField(): void {
    const dt = this.dt;
    for (let n = 0; n < this.totalCells; n++) {
      if (this.sourceEz[n] !== 0) {
        this.Ez[n] += dt * this.sourceEz[n];
      }
    }
  }

  /**
   * Update H using Faraday's law (normalized: μ=1):
   *   H_new = H_old - beta * curl(E)
   */
  private updateH(): void {
    const { nx, ny, nz, beta } = this;

    for (let k = 0; k < nz - 1; k++) {
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const ijk = this.idx(i, j, k);

          // Hx: -beta * (dEz/dy - dEy/dz)
          this.Hx[ijk] -= beta * (
            (this.Ez[this.idx(i, j + 1, k)] - this.Ez[ijk]) -
            (this.Ey[this.idx(i, j, k + 1)] - this.Ey[ijk])
          );

          // Hy: -beta * (dEx/dz - dEz/dx)
          this.Hy[ijk] -= beta * (
            (this.Ex[this.idx(i, j, k + 1)] - this.Ex[ijk]) -
            (this.Ez[this.idx(i + 1, j, k)] - this.Ez[ijk])
          );

          // Hz: -beta * (dEy/dx - dEx/dy)
          this.Hz[ijk] -= beta * (
            (this.Ey[this.idx(i + 1, j, k)] - this.Ey[ijk]) -
            (this.Ex[this.idx(i, j + 1, k)] - this.Ex[ijk])
          );
        }
      }
    }
  }

  /**
   * Update E using Ampère's law (normalized: ε=1):
   *   E_new = E_old + beta * curl(H)
   */
  private updateE(): void {
    const { nx, ny, nz, beta } = this;

    for (let k = 1; k < nz; k++) {
      for (let j = 1; j < ny; j++) {
        for (let i = 1; i < nx; i++) {
          const ijk = this.idx(i, j, k);

          // Ex: +beta * (dHz/dy - dHy/dz)
          this.Ex[ijk] += beta * (
            (this.Hz[ijk] - this.Hz[this.idx(i, j - 1, k)]) -
            (this.Hy[ijk] - this.Hy[this.idx(i, j, k - 1)])
          );

          // Ey: +beta * (dHx/dz - dHz/dx)
          this.Ey[ijk] += beta * (
            (this.Hx[ijk] - this.Hx[this.idx(i, j, k - 1)]) -
            (this.Hz[ijk] - this.Hz[this.idx(i - 1, j, k)])
          );

          // Ez: +beta * (dHy/dx - dHx/dy)
          this.Ez[ijk] += beta * (
            (this.Hy[ijk] - this.Hy[this.idx(i - 1, j, k)]) -
            (this.Hx[ijk] - this.Hx[this.idx(i, j - 1, k)])
          );
        }
      }
    }
  }

  /**
   * Absorbing sponge boundary — aggressively damps fields near grid edges.
   * Uses a thick layer with strong quadratic damping so waves are
   * essentially dead before they can reflect.
   */
  private applyBoundaryConditions(): void {
    const { nx, ny, nz } = this;
    // Use ~25% of grid as sponge on each side — aggressive absorption
    const depth = Math.floor(Math.min(nx, ny, nz) / 4);

    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const di = Math.max(0, depth - i, i - (nx - 1 - depth));
          const dj = Math.max(0, depth - j, j - (ny - 1 - depth));
          const dk = Math.max(0, depth - k, k - (nz - 1 - depth));
          const d = Math.max(di, dj, dk);

          if (d <= 0) continue;

          // Strong cubic damping: at boundary edge (t=1), decay ≈ 0.05
          // Energy drops to ~0.05^8 ≈ 0 across the sponge layer
          const t = d / depth;
          const decay = 1.0 - t * t * t * 0.95;

          const idx = this.idx(i, j, k);
          this.Ex[idx] *= decay;
          this.Ey[idx] *= decay;
          this.Ez[idx] *= decay;
          this.Hx[idx] *= decay;
          this.Hy[idx] *= decay;
          this.Hz[idx] *= decay;
        }
      }
    }
  }

  /** Reset all fields to zero */
  public reset(): void {
    this.Ex.fill(0);
    this.Ey.fill(0);
    this.Ez.fill(0);
    this.Hx.fill(0);
    this.Hy.fill(0);
    this.Hz.fill(0);
    this.sourceEz.fill(0);
    this.stepCount = 0;
    this.currentTime = 0;
  }

  public getFieldMagnitudeAt(i: number, j: number, k: number): number {
    const id = this.idx(i, j, k);
    const ex = this.Ex[id];
    const ey = this.Ey[id];
    const ez = this.Ez[id];
    return Math.sqrt(ex * ex + ey * ey + ez * ez);
  }

  public getFieldAt(i: number, j: number, k: number): [number, number, number] {
    const id = this.idx(i, j, k);
    return [this.Ex[id], this.Ey[id], this.Ez[id]];
  }
}
