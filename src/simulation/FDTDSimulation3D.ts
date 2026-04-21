/**
 * 3D FDTD (Finite-Difference Time-Domain) Simulation
 *
 * Solves Maxwell's curl equations on a 3D Yee grid:
 *
 *   ∂H/∂t = -(1/μ₀) ∇×E        (Faraday's law)
 *   ∂E/∂t =  (1/ε₀) ∇×H - J/ε₀ (Ampère's law with source current J)
 *
 * The Yee grid staggers E and H in space:
 *   - Ex(i+½, j, k),  Ey(i, j+½, k),  Ez(i, j, k+½)   — E on cell edges
 *   - Hx(i, j+½, k+½), Hy(i+½, j, k+½), Hz(i+½, j+½, k) — H on cell faces
 *
 * And in time (leapfrog):
 *   - H is updated at half-integer timesteps (t + ½Δt)
 *   - E is updated at integer timesteps (t + Δt)
 *
 * This leapfrog staggering gives second-order accuracy in both space and time.
 */

// Physical constants
const MU_0 = 4 * Math.PI * 1e-7;    // Permeability of free space (H/m)
const EPSILON_0 = 8.854187817e-12;   // Permittivity of free space (F/m)
const C = 1 / Math.sqrt(MU_0 * EPSILON_0); // Speed of light (~3e8 m/s)

export interface FDTDConfig {
  /** Number of cells in each dimension */
  nx: number;
  ny: number;
  nz: number;
  /** Physical size of each cell in meters */
  dx: number;
  /** Courant number (must be ≤ 1/√3 ≈ 0.577 for 3D stability) */
  courantNumber: number;
}

export interface FieldSource {
  /** Grid position of the source */
  ix: number;
  iy: number;
  iz: number;
  /** Frequency in Hz */
  frequency: number;
  /** Amplitude */
  amplitude: number;
  /** Which E component to inject into: 'x' | 'y' | 'z' */
  polarization: 'x' | 'y' | 'z';
  /**
   * Source type:
   * - 'continuous': sinusoidal oscillation (default)
   * - 'pulse': Gaussian-modulated sinusoidal pulse (multiple rings)
   * - 'impulse': single sharp Gaussian bump — one wavefront, no oscillation
   */
  type?: 'continuous' | 'pulse' | 'impulse';
  /** Width of the Gaussian envelope in seconds (for 'pulse' and 'impulse' types).
   *  Default: 3 periods for 'pulse', very narrow for 'impulse'. */
  pulseWidth?: number;
}

export class FDTDSimulation3D {
  // Grid dimensions
  public readonly nx: number;
  public readonly ny: number;
  public readonly nz: number;
  private readonly totalCells: number;

  // Physical parameters
  public readonly dx: number;   // Spatial step (same in all directions for simplicity)
  public readonly dt: number;   // Time step, derived from Courant condition

  // Update coefficients (precomputed for efficiency)
  // These come from discretizing Maxwell's equations:
  //   H_new = H_old - (dt/μ₀) * curl(E)    → coefficient for H update
  //   E_new = E_old + (dt/ε₀) * curl(H)    → coefficient for E update
  private readonly chh: number; // H-field self-coefficient (1.0 for lossless)
  private readonly che: number; // H-field curl(E) coefficient = dt / (μ₀ * dx)
  private readonly cee: number; // E-field self-coefficient (1.0 for lossless)
  private readonly ceh: number; // E-field curl(H) coefficient = dt / (ε₀ * dx)

  // Field arrays — flat Float32Arrays indexed as [i + j*nx + k*nx*ny]
  // Electric field components (on cell edges)
  public Ex: Float32Array;
  public Ey: Float32Array;
  public Ez: Float32Array;

  // Magnetic field components (on cell faces)
  public Hx: Float32Array;
  public Hy: Float32Array;
  public Hz: Float32Array;

  // Sources
  private sources: FieldSource[] = [];

  // Simulation state
  private stepCount: number = 0;
  private currentTime: number = 0;

  constructor(config: FDTDConfig) {
    this.nx = config.nx;
    this.ny = config.ny;
    this.nz = config.nz;
    this.totalCells = config.nx * config.ny * config.nz;

    this.dx = config.dx;

    // Time step from Courant condition:
    //   dt ≤ dx / (c * √3)  for 3D
    // The courant number S = c * dt / dx, so dt = S * dx / c
    this.dt = config.courantNumber * config.dx / C;

    // Precompute update coefficients for lossless free space:
    //   H update: H_new = 1.0 * H_old - (dt / (μ₀ * dx)) * curl(E)
    //   E update: E_new = 1.0 * E_old + (dt / (ε₀ * dx)) * curl(H)
    this.chh = 1.0;
    this.che = this.dt / (MU_0 * this.dx);
    this.cee = 1.0;
    this.ceh = this.dt / (EPSILON_0 * this.dx);

    // Allocate field arrays (initialized to zero = empty space, no fields)
    this.Ex = new Float32Array(this.totalCells);
    this.Ey = new Float32Array(this.totalCells);
    this.Ez = new Float32Array(this.totalCells);
    this.Hx = new Float32Array(this.totalCells);
    this.Hy = new Float32Array(this.totalCells);
    this.Hz = new Float32Array(this.totalCells);
  }

  /** Convert 3D grid indices to flat array index */
  public idx(i: number, j: number, k: number): number {
    return i + j * this.nx + k * this.nx * this.ny;
  }

  /** Add an oscillating source (e.g., a dipole antenna) */
  public addSource(source: FieldSource): void {
    this.sources.push(source);
  }

  /** Remove all sources */
  public clearSources(): void {
    this.sources = [];
  }

  /**
   * Inject a one-time field perturbation at a grid position.
   * This is how charges work: stamp a value into the E field,
   * then Maxwell's equations naturally propagate it outward.
   * No continuous injection — the physics handles the rest.
   */
  public injectImpulse(ix: number, iy: number, iz: number, amplitude: number): void {
    const idx = this.idx(ix, iy, iz);
    // Inject into all 3 E components for a spherical-ish wavefront
    this.Ez[idx] += amplitude;
  }

  /** Get current simulation step count */
  public getStepCount(): number {
    return this.stepCount;
  }

  /** Get current simulation time in seconds */
  public getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Advance the simulation by one timestep.
   *
   * The leapfrog update order is:
   *   1. Update H fields at t + ½Δt using E fields at t
   *   2. Inject sources into E at t + Δt
   *   3. Update E fields at t + Δt using H fields at t + ½Δt
   *   4. Apply boundary conditions
   */
  public step(): void {
    this.updateH();
    this.updateE();
    this.applyBoundaryConditions();

    this.stepCount++;
    this.currentTime += this.dt;
  }

  /**
   * Update magnetic field components using Faraday's law:
   *   ∂H/∂t = -(1/μ₀) ∇×E
   *
   * In finite differences (for Hx as an example):
   *   Hx(i,j,k) -= che * ( Ez(i,j+1,k) - Ez(i,j,k) - Ey(i,j,k+1) + Ey(i,j,k) )
   *
   * This is the discrete curl of E at the Hx location.
   * Similar equations for Hy and Hz, cycling the components.
   */
  private updateH(): void {
    const { nx, ny, nz, che, chh } = this;

    for (let k = 0; k < nz - 1; k++) {
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const ijk = this.idx(i, j, k);

          // Hx: depends on dEz/dy - dEy/dz
          this.Hx[ijk] = chh * this.Hx[ijk] - che * (
            (this.Ez[this.idx(i, j + 1, k)] - this.Ez[ijk]) -
            (this.Ey[this.idx(i, j, k + 1)] - this.Ey[ijk])
          );

          // Hy: depends on dEx/dz - dEz/dx
          this.Hy[ijk] = chh * this.Hy[ijk] - che * (
            (this.Ex[this.idx(i, j, k + 1)] - this.Ex[ijk]) -
            (this.Ez[this.idx(i + 1, j, k)] - this.Ez[ijk])
          );

          // Hz: depends on dEy/dx - dEx/dy
          this.Hz[ijk] = chh * this.Hz[ijk] - che * (
            (this.Ey[this.idx(i + 1, j, k)] - this.Ey[ijk]) -
            (this.Ex[this.idx(i, j + 1, k)] - this.Ex[ijk])
          );
        }
      }
    }
  }

  /**
   * Update electric field components using Ampère's law:
   *   ∂E/∂t = (1/ε₀) ∇×H
   *
   * In finite differences (for Ex as an example):
   *   Ex(i,j,k) += ceh * ( Hz(i,j,k) - Hz(i,j-1,k) - Hy(i,j,k) + Hy(i,j,k-1) )
   *
   * Note the index offsets are reversed compared to H update — this is because
   * E and H are at staggered positions, so the curl at an E location uses
   * H values that bracket it.
   */
  private updateE(): void {
    const { nx, ny, nz, ceh, cee } = this;

    for (let k = 1; k < nz; k++) {
      for (let j = 1; j < ny; j++) {
        for (let i = 1; i < nx; i++) {
          const ijk = this.idx(i, j, k);

          // Ex: depends on dHz/dy - dHy/dz
          this.Ex[ijk] = cee * this.Ex[ijk] + ceh * (
            (this.Hz[ijk] - this.Hz[this.idx(i, j - 1, k)]) -
            (this.Hy[ijk] - this.Hy[this.idx(i, j, k - 1)])
          );

          // Ey: depends on dHx/dz - dHz/dx
          this.Ey[ijk] = cee * this.Ey[ijk] + ceh * (
            (this.Hx[ijk] - this.Hx[this.idx(i, j, k - 1)]) -
            (this.Hz[ijk] - this.Hz[this.idx(i - 1, j, k)])
          );

          // Ez: depends on dHy/dx - dHx/dy
          this.Ez[ijk] = cee * this.Ez[ijk] + ceh * (
            (this.Hy[ijk] - this.Hy[this.idx(i - 1, j, k)]) -
            (this.Hx[ijk] - this.Hx[this.idx(i, j - 1, k)])
          );
        }
      }
    }
  }

  /**
   * Inject source currents into the E field.
   *
   * We use a "soft source" — adding to the field rather than overwriting it.
   * This lets waves pass through the source point instead of reflecting off it.
   *
   * Two modes:
   * - 'continuous': amplitude * sin(2π * f * t)  — steady oscillation
   * - 'pulse': amplitude * exp(-((t-t0)²)/(2σ²)) * sin(2π * f * t) — single burst
   *    where t0 = 3σ (delayed so the pulse starts near zero) and σ = pulseWidth
   */
  private injectSources(): void {
    for (const source of this.sources) {
      let value: number;

      if (source.type === 'impulse') {
        // Single sharp Gaussian bump — one wavefront, no oscillation
        // Like dropping a rock in water: one ripple expands outward
        const sigma = source.pulseWidth ?? (this.dt * 30); // ~30 timesteps wide for stability
        const t0 = 3 * sigma; // slight delay so it starts near zero
        const t = this.currentTime;
        value = source.amplitude * Math.exp(-((t - t0) * (t - t0)) / (2 * sigma * sigma));
      } else if (source.type === 'pulse') {
        // Gaussian-modulated sinusoidal pulse (multiple rings)
        const sigma = source.pulseWidth ?? (3 / source.frequency);
        const t0 = 3 * sigma;
        const t = this.currentTime;
        const envelope = Math.exp(-((t - t0) * (t - t0)) / (2 * sigma * sigma));
        value = source.amplitude * envelope * Math.sin(2 * Math.PI * source.frequency * t);
      } else {
        // Continuous sinusoidal
        value = source.amplitude * Math.sin(
          2 * Math.PI * source.frequency * this.currentTime
        );
      }

      const idx = this.idx(source.ix, source.iy, source.iz);

      switch (source.polarization) {
        case 'x': this.Ex[idx] += value; break;
        case 'y': this.Ey[idx] += value; break;
        case 'z': this.Ez[idx] += value; break;
      }
    }
  }

  /**
   * Absorbing boundary conditions using a damping sponge layer.
   *
   * Instead of PEC (which reflects waves), we apply exponential damping
   * in a layer near each boundary. Fields are multiplied by a decay factor
   * that increases toward the edges, absorbing outgoing waves so they
   * fade away instead of bouncing back.
   */
  private readonly spongeDepth = 6; // cells of damping near each boundary
  private readonly maxDamping = 0.6; // damping factor at the outermost cell (0 = full absorb, 1 = no absorb)

  private applyBoundaryConditions(): void {
    const { nx, ny, nz } = this;
    const depth = Math.min(this.spongeDepth, Math.floor(Math.min(nx, ny, nz) / 4));

    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          // How deep into the sponge layer is this cell?
          // 0 = not in sponge, depth = at the boundary edge
          const di = Math.max(0, depth - i, i - (nx - 1 - depth));
          const dj = Math.max(0, depth - j, j - (ny - 1 - depth));
          const dk = Math.max(0, depth - k, k - (nz - 1 - depth));
          const d = Math.max(di, dj, dk);

          if (d <= 0) continue; // not in sponge layer

          // Quadratic damping profile: stronger near the edge
          const t = d / depth; // 0 at sponge inner edge, 1 at grid boundary
          const decay = 1.0 - t * t * (1.0 - this.maxDamping);

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
    this.stepCount = 0;
    this.currentTime = 0;
  }

  /**
   * Read the total E field magnitude at a grid point.
   * Returns sqrt(Ex² + Ey² + Ez²).
   */
  public getFieldMagnitudeAt(i: number, j: number, k: number): number {
    const idx = this.idx(i, j, k);
    const ex = this.Ex[idx];
    const ey = this.Ey[idx];
    const ez = this.Ez[idx];
    return Math.sqrt(ex * ex + ey * ey + ez * ez);
  }

  /**
   * Read E field vector at a grid point.
   * Returns [Ex, Ey, Ez].
   */
  public getFieldAt(i: number, j: number, k: number): [number, number, number] {
    const idx = this.idx(i, j, k);
    return [this.Ex[idx], this.Ey[idx], this.Ez[idx]];
  }

  /**
   * Read H field vector at a grid point.
   * Returns [Hx, Hy, Hz].
   */
  public getHFieldAt(i: number, j: number, k: number): [number, number, number] {
    const idx = this.idx(i, j, k);
    return [this.Hx[idx], this.Hy[idx], this.Hz[idx]];
  }
}

/** Create a default simulation config suitable for visualization */
export function createDefaultFDTDConfig(): FDTDConfig {
  return {
    nx: 32,
    ny: 32,
    nz: 32,
    dx: 0.01,               // 1cm cells → 32cm total grid
    courantNumber: 0.5,      // Safe value (max for 3D is 1/√3 ≈ 0.577)
  };
}
