/**
 * GPU-accelerated 3D FDTD simulation using WebGPU compute shaders.
 *
 * Same physics as FDTDSimulation3D (CPU version) but runs all field updates
 * on the GPU in parallel. For a 32³ grid that's ~30K threads running
 * simultaneously instead of a sequential triple-nested loop.
 *
 * Architecture:
 *   - 6 storage buffers on GPU: Ex, Ey, Ez, Hx, Hy, Hz
 *   - 4 compute pipelines: updateH, updateE, injectSource, applyBoundary
 *   - Each step() dispatches these pipelines in order
 *   - readback() copies E fields to CPU for Three.js visualization
 */

import type { FDTDConfig, FieldSource } from './FDTDSimulation3D';

// Import shader source as strings (Vite handles ?raw imports)
import updateHSource from '../shaders/updateH.wgsl?raw';
import updateESource from '../shaders/updateE.wgsl?raw';
import injectSourceSource from '../shaders/injectSource.wgsl?raw';
import applyBoundarySource from '../shaders/applyBoundary.wgsl?raw';

const MU_0 = 4 * Math.PI * 1e-7;
const EPSILON_0 = 8.854187817e-12;
const C = 1 / Math.sqrt(MU_0 * EPSILON_0);

export class FDTDSimulationGPU {
  // Grid dimensions
  public readonly nx: number;
  public readonly ny: number;
  public readonly nz: number;
  private readonly totalCells: number;

  // Physical parameters
  public readonly dx: number;
  public readonly dt: number;
  private readonly chh: number;
  private readonly che: number;
  private readonly cee: number;
  private readonly ceh: number;

  // WebGPU resources
  private device: GPUDevice;

  // Storage buffers for field components (live on GPU)
  private exBuffer!: GPUBuffer;
  private eyBuffer!: GPUBuffer;
  private ezBuffer!: GPUBuffer;
  private hxBuffer!: GPUBuffer;
  private hyBuffer!: GPUBuffer;
  private hzBuffer!: GPUBuffer;

  // Staging buffer for reading E fields back to CPU
  private readbackBuffer!: GPUBuffer;

  // Uniform buffers
  private hParamsBuffer!: GPUBuffer;
  private eParamsBuffer!: GPUBuffer;
  private boundaryParamsBuffer!: GPUBuffer;
  private sourceParamsBuffer!: GPUBuffer;

  // Compute pipelines
  private updateHPipeline!: GPUComputePipeline;
  private updateEPipeline!: GPUComputePipeline;
  private injectSourcePipeline!: GPUComputePipeline;
  private boundaryPipeline!: GPUComputePipeline;

  // Bind groups
  private updateHBindGroup!: GPUBindGroup;
  private updateEBindGroup!: GPUBindGroup;
  private boundaryBindGroup!: GPUBindGroup;

  // Sources and state
  private sources: FieldSource[] = [];
  private stepCount: number = 0;
  private currentTime: number = 0;

  // CPU-side field copies (populated by readback)
  public Ex: Float32Array;
  public Ey: Float32Array;
  public Ez: Float32Array;

  // Dispatch dimensions (workgroup count)
  private dispatchX: number;
  private dispatchY: number;
  private dispatchZ: number;

  private constructor(device: GPUDevice, config: FDTDConfig) {
    this.device = device;
    this.nx = config.nx;
    this.ny = config.ny;
    this.nz = config.nz;
    this.totalCells = config.nx * config.ny * config.nz;
    this.dx = config.dx;
    this.dt = config.courantNumber * config.dx / C;

    this.chh = 1.0;
    this.che = this.dt / (MU_0 * this.dx);
    this.cee = 1.0;
    this.ceh = this.dt / (EPSILON_0 * this.dx);

    // CPU-side copies for visualization readback
    this.Ex = new Float32Array(this.totalCells);
    this.Ey = new Float32Array(this.totalCells);
    this.Ez = new Float32Array(this.totalCells);

    // Workgroup size is 4x4x4 = 64 threads per workgroup
    this.dispatchX = Math.ceil(this.nx / 4);
    this.dispatchY = Math.ceil(this.ny / 4);
    this.dispatchZ = Math.ceil(this.nz / 4);
  }

  /**
   * Async factory — WebGPU pipeline creation is async, so we can't do it
   * in the constructor.
   */
  static async create(device: GPUDevice, config: FDTDConfig): Promise<FDTDSimulationGPU> {
    const sim = new FDTDSimulationGPU(device, config);
    await sim.initGPUResources();
    return sim;
  }

  private async initGPUResources(): Promise<void> {
    const bufferSize = this.totalCells * 4; // 4 bytes per f32

    // Create storage buffers for all 6 field components
    const createFieldBuffer = () => this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    this.exBuffer = createFieldBuffer();
    this.eyBuffer = createFieldBuffer();
    this.ezBuffer = createFieldBuffer();
    this.hxBuffer = createFieldBuffer();
    this.hyBuffer = createFieldBuffer();
    this.hzBuffer = createFieldBuffer();

    // Readback buffer (3 fields * totalCells * 4 bytes) for copying E fields to CPU
    this.readbackBuffer = this.device.createBuffer({
      size: bufferSize * 3,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // --- H update uniform: { nx, ny, nz, chh, che } ---
    this.hParamsBuffer = this.device.createBuffer({
      size: 32, // 3 u32 + 2 f32, padded to 32 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const hParams = new ArrayBuffer(32);
    const hView = new DataView(hParams);
    hView.setUint32(0, this.nx, true);
    hView.setUint32(4, this.ny, true);
    hView.setUint32(8, this.nz, true);
    hView.setFloat32(12, this.chh, true);
    hView.setFloat32(16, this.che, true);
    this.device.queue.writeBuffer(this.hParamsBuffer, 0, hParams);

    // --- E update uniform: { nx, ny, nz, cee, ceh } ---
    this.eParamsBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const eParams = new ArrayBuffer(32);
    const eView = new DataView(eParams);
    eView.setUint32(0, this.nx, true);
    eView.setUint32(4, this.ny, true);
    eView.setUint32(8, this.nz, true);
    eView.setFloat32(12, this.cee, true);
    eView.setFloat32(16, this.ceh, true);
    this.device.queue.writeBuffer(this.eParamsBuffer, 0, eParams);

    // --- Boundary uniform: { nx, ny, nz, _pad } ---
    this.boundaryParamsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bParams = new ArrayBuffer(16);
    const bView = new DataView(bParams);
    bView.setUint32(0, this.nx, true);
    bView.setUint32(4, this.ny, true);
    bView.setUint32(8, this.nz, true);
    bView.setUint32(12, 0, true);
    this.device.queue.writeBuffer(this.boundaryParamsBuffer, 0, bParams);

    // --- Source uniform buffer (updated each step) ---
    this.sourceParamsBuffer = this.device.createBuffer({
      size: 32, // { ix, iy, iz, polarization, value, nx, ny, _pad }
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // --- Create compute pipelines ---
    this.updateHPipeline = await this.createPipeline(updateHSource);
    this.updateEPipeline = await this.createPipeline(updateESource);
    this.injectSourcePipeline = await this.createPipeline(injectSourceSource);
    this.boundaryPipeline = await this.createPipeline(applyBoundarySource);

    // --- Create bind groups ---
    // H update: params, Ex(r), Ey(r), Ez(r), Hx(rw), Hy(rw), Hz(rw)
    this.updateHBindGroup = this.device.createBindGroup({
      layout: this.updateHPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.hParamsBuffer } },
        { binding: 1, resource: { buffer: this.exBuffer } },
        { binding: 2, resource: { buffer: this.eyBuffer } },
        { binding: 3, resource: { buffer: this.ezBuffer } },
        { binding: 4, resource: { buffer: this.hxBuffer } },
        { binding: 5, resource: { buffer: this.hyBuffer } },
        { binding: 6, resource: { buffer: this.hzBuffer } },
      ],
    });

    // E update: params, Hx(r), Hy(r), Hz(r), Ex(rw), Ey(rw), Ez(rw)
    this.updateEBindGroup = this.device.createBindGroup({
      layout: this.updateEPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.eParamsBuffer } },
        { binding: 1, resource: { buffer: this.hxBuffer } },
        { binding: 2, resource: { buffer: this.hyBuffer } },
        { binding: 3, resource: { buffer: this.hzBuffer } },
        { binding: 4, resource: { buffer: this.exBuffer } },
        { binding: 5, resource: { buffer: this.eyBuffer } },
        { binding: 6, resource: { buffer: this.ezBuffer } },
      ],
    });

    // Boundary: params, Ex(rw), Ey(rw), Ez(rw)
    this.boundaryBindGroup = this.device.createBindGroup({
      layout: this.boundaryPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.boundaryParamsBuffer } },
        { binding: 1, resource: { buffer: this.exBuffer } },
        { binding: 2, resource: { buffer: this.eyBuffer } },
        { binding: 3, resource: { buffer: this.ezBuffer } },
      ],
    });
  }

  private async createPipeline(shaderSource: string): Promise<GPUComputePipeline> {
    const module = this.device.createShaderModule({ code: shaderSource });
    return this.device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  }

  /** Add an oscillating source */
  public addSource(source: FieldSource): void {
    this.sources.push(source);
  }

  /** Remove all sources */
  public clearSources(): void {
    this.sources = [];
  }

  public getStepCount(): number {
    return this.stepCount;
  }

  public getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Run one FDTD timestep entirely on the GPU.
   *
   * Dispatches: updateH → updateE → injectSources → applyBoundary
   * All in a single command buffer submitted to the GPU queue.
   */
  public step(): void {
    const encoder = this.device.createCommandEncoder();

    // 1. Update H fields
    const hPass = encoder.beginComputePass();
    hPass.setPipeline(this.updateHPipeline);
    hPass.setBindGroup(0, this.updateHBindGroup);
    hPass.dispatchWorkgroups(this.dispatchX, this.dispatchY, this.dispatchZ);
    hPass.end();

    // 2. Update E fields
    const ePass = encoder.beginComputePass();
    ePass.setPipeline(this.updateEPipeline);
    ePass.setBindGroup(0, this.updateEBindGroup);
    ePass.dispatchWorkgroups(this.dispatchX, this.dispatchY, this.dispatchZ);
    ePass.end();

    // 3. Inject sources (one dispatch per source)
    for (const source of this.sources) {
      let value: number;
      if (source.type === 'pulse') {
        const sigma = source.pulseWidth ?? (3 / source.frequency);
        const t0 = 3 * sigma;
        const t = this.currentTime;
        const envelope = Math.exp(-((t - t0) * (t - t0)) / (2 * sigma * sigma));
        value = source.amplitude * envelope * Math.sin(2 * Math.PI * source.frequency * t);
      } else {
        value = source.amplitude * Math.sin(
          2 * Math.PI * source.frequency * this.currentTime
        );
      }

      // Write source params to GPU
      const sParams = new ArrayBuffer(32);
      const sView = new DataView(sParams);
      sView.setUint32(0, source.ix, true);
      sView.setUint32(4, source.iy, true);
      sView.setUint32(8, source.iz, true);
      sView.setUint32(12, source.polarization === 'x' ? 0 : source.polarization === 'y' ? 1 : 2, true);
      sView.setFloat32(16, value, true);
      sView.setUint32(20, this.nx, true);
      sView.setUint32(24, this.ny, true);
      sView.setUint32(28, 0, true); // padding
      this.device.queue.writeBuffer(this.sourceParamsBuffer, 0, sParams);

      // Create bind group for this source dispatch
      const sourceBindGroup = this.device.createBindGroup({
        layout: this.injectSourcePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.sourceParamsBuffer } },
          { binding: 1, resource: { buffer: this.exBuffer } },
          { binding: 2, resource: { buffer: this.eyBuffer } },
          { binding: 3, resource: { buffer: this.ezBuffer } },
        ],
      });

      const sPass = encoder.beginComputePass();
      sPass.setPipeline(this.injectSourcePipeline);
      sPass.setBindGroup(0, sourceBindGroup);
      sPass.dispatchWorkgroups(1); // Only one thread needed
      sPass.end();
    }

    // 4. Apply boundary conditions
    const bPass = encoder.beginComputePass();
    bPass.setPipeline(this.boundaryPipeline);
    bPass.setBindGroup(0, this.boundaryBindGroup);
    bPass.dispatchWorkgroups(this.dispatchX, this.dispatchY, this.dispatchZ);
    bPass.end();

    this.device.queue.submit([encoder.finish()]);

    this.stepCount++;
    this.currentTime += this.dt;
  }

  /**
   * Copy E field data from GPU back to CPU Float32Arrays.
   * The FDTDVectorFieldRenderer reads from these arrays.
   *
   * This is async because GPU→CPU readback requires mapping the buffer.
   * Call this once per frame (not once per step).
   */
  public async readback(): Promise<void> {
    const bufferSize = this.totalCells * 4;

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.exBuffer, 0, this.readbackBuffer, 0, bufferSize);
    encoder.copyBufferToBuffer(this.eyBuffer, 0, this.readbackBuffer, bufferSize, bufferSize);
    encoder.copyBufferToBuffer(this.ezBuffer, 0, this.readbackBuffer, bufferSize * 2, bufferSize);
    this.device.queue.submit([encoder.finish()]);

    await this.readbackBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(this.readbackBuffer.getMappedRange());
    this.Ex.set(data.subarray(0, this.totalCells));
    this.Ey.set(data.subarray(this.totalCells, this.totalCells * 2));
    this.Ez.set(data.subarray(this.totalCells * 2, this.totalCells * 3));
    this.readbackBuffer.unmap();
  }

  /** Reset all fields to zero */
  public reset(): void {
    const zeros = new Float32Array(this.totalCells);
    this.device.queue.writeBuffer(this.exBuffer, 0, zeros);
    this.device.queue.writeBuffer(this.eyBuffer, 0, zeros);
    this.device.queue.writeBuffer(this.ezBuffer, 0, zeros);
    this.device.queue.writeBuffer(this.hxBuffer, 0, zeros);
    this.device.queue.writeBuffer(this.hyBuffer, 0, zeros);
    this.device.queue.writeBuffer(this.hzBuffer, 0, zeros);
    this.Ex.fill(0);
    this.Ey.fill(0);
    this.Ez.fill(0);
    this.stepCount = 0;
    this.currentTime = 0;
  }

  /** Helper methods for compatibility with the vector field renderer */
  public idx(i: number, j: number, k: number): number {
    return i + j * this.nx + k * this.nx * this.ny;
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

  /** Clean up GPU resources */
  public destroy(): void {
    this.exBuffer.destroy();
    this.eyBuffer.destroy();
    this.ezBuffer.destroy();
    this.hxBuffer.destroy();
    this.hyBuffer.destroy();
    this.hzBuffer.destroy();
    this.readbackBuffer.destroy();
    this.hParamsBuffer.destroy();
    this.eParamsBuffer.destroy();
    this.boundaryParamsBuffer.destroy();
    this.sourceParamsBuffer.destroy();
  }
}
