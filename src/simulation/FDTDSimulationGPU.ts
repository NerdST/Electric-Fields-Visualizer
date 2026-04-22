/**
 * GPU-accelerated 3D FDTD simulation using WebGPU compute shaders.
 *
 * Same physics as FDTDSimulation3D (CPU) but massively parallel on GPU.
 * Uses normalized units (μ=1, ε=1) matching Sangeeth's 2D implementation.
 *
 * Architecture:
 *   - 6 storage buffers: Ex, Ey, Ez, Hx, Hy, Hz
 *   - 1 source field buffer: sourceEz (persistent charge field)
 *   - 4 compute pipelines: injectSourceField, updateE, updateH, applyBoundary
 *   - readback() copies E fields to CPU for Three.js visualization
 */

import type { FDTDConfig } from './FDTDSimulation3D';

import updateHSource from '../shaders/updateH.wgsl?raw';
import updateESource from '../shaders/updateE.wgsl?raw';
import injectSourceFieldSource from '../shaders/injectSourceField.wgsl?raw';
import applyBoundarySource from '../shaders/applyBoundary.wgsl?raw';

export class FDTDSimulationGPU {
  public readonly nx: number;
  public readonly ny: number;
  public readonly nz: number;
  private readonly totalCells: number;

  public readonly dx: number;
  public readonly dt: number;
  private readonly beta: number;

  private device: GPUDevice;

  // Field buffers on GPU
  private exBuffer!: GPUBuffer;
  private eyBuffer!: GPUBuffer;
  private ezBuffer!: GPUBuffer;
  private hxBuffer!: GPUBuffer;
  private hyBuffer!: GPUBuffer;
  private hzBuffer!: GPUBuffer;

  // Source field (persistent charges)
  private sourceEzBuffer!: GPUBuffer;

  // Readback buffer
  private readbackBuffer!: GPUBuffer;

  // Uniform buffers
  private hParamsBuffer!: GPUBuffer;
  private eParamsBuffer!: GPUBuffer;
  private boundaryParamsBuffer!: GPUBuffer;
  private sourceFieldParamsBuffer!: GPUBuffer;

  // Pipelines
  private updateHPipeline!: GPUComputePipeline;
  private updateEPipeline!: GPUComputePipeline;
  private injectSourceFieldPipeline!: GPUComputePipeline;
  private boundaryPipeline!: GPUComputePipeline;

  // Bind groups
  private updateHBindGroup!: GPUBindGroup;
  private updateEBindGroup!: GPUBindGroup;
  private injectSourceFieldBindGroup!: GPUBindGroup;
  private boundaryBindGroup!: GPUBindGroup;

  // State
  private sources: any[] = [];
  private stepCount: number = 0;
  private currentTime: number = 0;

  // CPU-side copies (populated by readback)
  public Ex: Float32Array;
  public Ey: Float32Array;
  public Ez: Float32Array;

  // CPU-side source field (written to GPU when charges change)
  private sourceEzCPU: Float32Array;

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
    this.dt = config.dt;
    this.beta = config.dt / config.dx;

    this.Ex = new Float32Array(this.totalCells);
    this.Ey = new Float32Array(this.totalCells);
    this.Ez = new Float32Array(this.totalCells);
    this.sourceEzCPU = new Float32Array(this.totalCells);

    this.dispatchX = Math.ceil(this.nx / 4);
    this.dispatchY = Math.ceil(this.ny / 4);
    this.dispatchZ = Math.ceil(this.nz / 4);
  }

  static async create(device: GPUDevice, config: FDTDConfig): Promise<FDTDSimulationGPU> {
    const sim = new FDTDSimulationGPU(device, config);
    await sim.initGPUResources();
    return sim;
  }

  private async initGPUResources(): Promise<void> {
    const bufferSize = this.totalCells * 4;

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
    this.sourceEzBuffer = createFieldBuffer();

    this.readbackBuffer = this.device.createBuffer({
      size: bufferSize * 3,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // H update params: { nx, ny, nz, chh(=1.0), che(=beta) }
    this.hParamsBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const hParams = new ArrayBuffer(32);
    const hView = new DataView(hParams);
    hView.setUint32(0, this.nx, true);
    hView.setUint32(4, this.ny, true);
    hView.setUint32(8, this.nz, true);
    hView.setFloat32(12, 1.0, true);       // chh = 1.0 (lossless)
    hView.setFloat32(16, this.beta, true); // che = beta = dt/dx
    this.device.queue.writeBuffer(this.hParamsBuffer, 0, hParams);

    // E update params: { nx, ny, nz, cee(=1.0), ceh(=beta) }
    this.eParamsBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const eParams = new ArrayBuffer(32);
    const eView = new DataView(eParams);
    eView.setUint32(0, this.nx, true);
    eView.setUint32(4, this.ny, true);
    eView.setUint32(8, this.nz, true);
    eView.setFloat32(12, 1.0, true);       // cee = 1.0
    eView.setFloat32(16, this.beta, true); // ceh = beta = dt/dx
    this.device.queue.writeBuffer(this.eParamsBuffer, 0, eParams);

    // Boundary params: { nx, ny, nz, spongeDepth }
    const spongeDepth = Math.floor(Math.min(this.nx, this.ny, this.nz) / 4);
    this.boundaryParamsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bParams = new ArrayBuffer(16);
    const bView = new DataView(bParams);
    bView.setUint32(0, this.nx, true);
    bView.setUint32(4, this.ny, true);
    bView.setUint32(8, this.nz, true);
    bView.setUint32(12, spongeDepth, true);
    this.device.queue.writeBuffer(this.boundaryParamsBuffer, 0, bParams);

    // Source field injection params: { nx, ny, nz, dt }
    this.sourceFieldParamsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const sfParams = new ArrayBuffer(16);
    const sfView = new DataView(sfParams);
    sfView.setUint32(0, this.nx, true);
    sfView.setUint32(4, this.ny, true);
    sfView.setUint32(8, this.nz, true);
    sfView.setFloat32(12, this.dt, true);
    this.device.queue.writeBuffer(this.sourceFieldParamsBuffer, 0, sfParams);

    // Create pipelines
    this.updateHPipeline = await this.createPipeline(updateHSource);
    this.updateEPipeline = await this.createPipeline(updateESource);
    this.injectSourceFieldPipeline = await this.createPipeline(injectSourceFieldSource);
    this.boundaryPipeline = await this.createPipeline(applyBoundarySource);

    // Bind groups
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

    this.injectSourceFieldBindGroup = this.device.createBindGroup({
      layout: this.injectSourceFieldPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sourceFieldParamsBuffer } },
        { binding: 1, resource: { buffer: this.sourceEzBuffer } },
        { binding: 2, resource: { buffer: this.ezBuffer } },
      ],
    });

    this.boundaryBindGroup = this.device.createBindGroup({
      layout: this.boundaryPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.boundaryParamsBuffer } },
        { binding: 1, resource: { buffer: this.exBuffer } },
        { binding: 2, resource: { buffer: this.eyBuffer } },
        { binding: 3, resource: { buffer: this.ezBuffer } },
        { binding: 4, resource: { buffer: this.hxBuffer } },
        { binding: 5, resource: { buffer: this.hyBuffer } },
        { binding: 6, resource: { buffer: this.hzBuffer } },
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

  // Legacy API compatibility
  public addSource(source: any): void { this.sources.push(source); }
  public clearSources(): void { this.sources = []; }

  /**
   * Inject a charge into the persistent source field.
   * Writes to CPU array, then uploads to GPU.
   */
  public injectImpulse(ix: number, iy: number, iz: number, amplitude: number): void {
    const idx = ix + iy * this.nx + iz * this.nx * this.ny;
    this.sourceEzCPU[idx] += amplitude;
    // Upload to GPU
    this.device.queue.writeBuffer(this.sourceEzBuffer, 0, this.sourceEzCPU.buffer);
  }

  /** Clear the source field */
  public clearSourceField(): void {
    this.sourceEzCPU.fill(0);
    this.device.queue.writeBuffer(this.sourceEzBuffer, 0, this.sourceEzCPU.buffer);
  }

  public getStepCount(): number { return this.stepCount; }
  public getCurrentTime(): number { return this.currentTime; }

  /**
   * One FDTD timestep on GPU:
   *   1. Inject source field: Ez += dt * sourceEz
   *   2. Update E from curl(H)
   *   3. Update H from curl(E)
   *   4. Apply absorbing boundary
   */
  public step(): void {
    const encoder = this.device.createCommandEncoder();

    // 1. Inject source field
    const sfPass = encoder.beginComputePass();
    sfPass.setPipeline(this.injectSourceFieldPipeline);
    sfPass.setBindGroup(0, this.injectSourceFieldBindGroup);
    sfPass.dispatchWorkgroups(this.dispatchX, this.dispatchY, this.dispatchZ);
    sfPass.end();

    // 2. Update E
    const ePass = encoder.beginComputePass();
    ePass.setPipeline(this.updateEPipeline);
    ePass.setBindGroup(0, this.updateEBindGroup);
    ePass.dispatchWorkgroups(this.dispatchX, this.dispatchY, this.dispatchZ);
    ePass.end();

    // 3. Update H
    const hPass = encoder.beginComputePass();
    hPass.setPipeline(this.updateHPipeline);
    hPass.setBindGroup(0, this.updateHBindGroup);
    hPass.dispatchWorkgroups(this.dispatchX, this.dispatchY, this.dispatchZ);
    hPass.end();

    // 4. Apply boundary
    const bPass = encoder.beginComputePass();
    bPass.setPipeline(this.boundaryPipeline);
    bPass.setBindGroup(0, this.boundaryBindGroup);
    bPass.dispatchWorkgroups(this.dispatchX, this.dispatchY, this.dispatchZ);
    bPass.end();

    this.device.queue.submit([encoder.finish()]);

    this.stepCount++;
    this.currentTime += this.dt;
  }

  /** Copy E fields from GPU to CPU for visualization */
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

  /** Reset all fields and source field */
  public reset(): void {
    const zeros = new Float32Array(this.totalCells);
    const buf = zeros.buffer as ArrayBuffer;
    this.device.queue.writeBuffer(this.exBuffer, 0, buf);
    this.device.queue.writeBuffer(this.eyBuffer, 0, buf);
    this.device.queue.writeBuffer(this.ezBuffer, 0, buf);
    this.device.queue.writeBuffer(this.hxBuffer, 0, buf);
    this.device.queue.writeBuffer(this.hyBuffer, 0, buf);
    this.device.queue.writeBuffer(this.hzBuffer, 0, buf);
    this.device.queue.writeBuffer(this.sourceEzBuffer, 0, buf);
    this.Ex.fill(0);
    this.Ey.fill(0);
    this.Ez.fill(0);
    this.sourceEzCPU.fill(0);
    this.stepCount = 0;
    this.currentTime = 0;
  }

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

  public destroy(): void {
    this.exBuffer.destroy();
    this.eyBuffer.destroy();
    this.ezBuffer.destroy();
    this.hxBuffer.destroy();
    this.hyBuffer.destroy();
    this.hzBuffer.destroy();
    this.sourceEzBuffer.destroy();
    this.readbackBuffer.destroy();
    this.hParamsBuffer.destroy();
    this.eParamsBuffer.destroy();
    this.boundaryParamsBuffer.destroy();
    this.sourceFieldParamsBuffer.destroy();
  }
}
