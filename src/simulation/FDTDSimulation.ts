// Enhanced FDTD Simulation class
export class FDTDSimulation {
  private device: GPUDevice;
  private pipelines: Map<string, GPUComputePipeline> = new Map();
  private textures: Map<string, GPUTexture> = new Map();
  private buffers: Map<string, GPUBuffer> = new Map();
  private sampler!: GPUSampler;
  private textureSize: number;
  private dt: number = 0.001;
  private cellSize: number = 0.01;
  private time: number = 0;
  private alphaBetaDt: number = 0.001; // Track dt used for alpha-beta calculation
  private readbackBuffer: GPUBuffer | null = null;
  private stagingBuffer: GPUBuffer | null = null;
  private stagingBufferMapped: boolean = false; // Track if staging buffer is mapped
  private readbackInProgress: boolean = false; // Prevent concurrent readback calls

  constructor(device: GPUDevice, textureSize: number = 512) {
    this.device = device;
    this.textureSize = textureSize;
    this.initializeSampler();
  }

  public getTextureSize(): number {
    return this.textureSize;
  }

  private initializeSampler() {
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  async initializePipelines(shaders: Record<string, string>) {
    for (const [name, shader] of Object.entries(shaders)) {
      try {
        console.log(`Creating shader module: ${name}`);
        const module = this.device.createShaderModule({
          code: shader,
          label: `${name}_shader_module`
        });

        // Check for compilation info
        const compilationInfo = await module.getCompilationInfo();
        if (compilationInfo.messages.length > 0) {
          console.log(`Shader ${name} compilation info:`, compilationInfo.messages);
          for (const message of compilationInfo.messages) {
            console.log(`  ${message.type}: ${message.message} at line ${message.lineNum}, pos ${message.linePos}`);
          }
        }

        const pipeline = this.device.createComputePipeline({
          layout: 'auto',
          compute: {
            module,
            entryPoint: 'main',
          },
          label: `${name}_pipeline`,
        });
        this.pipelines.set(name, pipeline);
      } catch (error) {
        console.error(`Error creating shader ${name}:`, error);
        console.log(`Shader code for ${name}:`, shader);
        throw error;
      }
    }
  }

  initializeTextures() {
    // Create main field textures (double buffered)
    this.createTexture('electricField', this.textureSize, this.textureSize);
    this.createTexture('electricFieldNext', this.textureSize, this.textureSize);
    this.createTexture('magneticField', this.textureSize, this.textureSize);
    this.createTexture('magneticFieldNext', this.textureSize, this.textureSize);

    // Create auxiliary textures
    this.createTexture('alphaBetaField', this.textureSize, this.textureSize);
    this.createTexture('materialField', this.textureSize, this.textureSize, 'rgba8unorm'); // Use widely supported filterable format
    this.createTexture('sourceField', this.textureSize, this.textureSize);
    this.createTexture('sourceFieldNext', this.textureSize, this.textureSize); // Add double buffer for source field

    // Initialize material properties (vacuum by default)
    this.initializeMaterialField();
    this.initializeAlphaBeta();

    // Initialize readback buffers for CPU access
    this.initializeReadbackBuffers();
  }

  private initializeReadbackBuffers() {
    // Storage buffer for GPU to write field values
    this.readbackBuffer = this.device.createBuffer({
      size: 16, // 4 floats (Ex, Ey, Ez, magnitude)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      label: 'readback_buffer'
    });

    // Staging buffer for CPU to read from
    this.stagingBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      label: 'staging_buffer'
    });
  }

  private initializeMaterialField() {
    // Initialize with vacuum properties
    // For rgba8unorm, values are automatically normalized to [0,1]
    // Vacuum: permeability ≈ 1.0, permittivity ≈ 1.0, conductivity = 0
    const materialData = new Uint8Array(this.textureSize * this.textureSize * 4);
    for (let i = 0; i < materialData.length; i += 4) {
      materialData[i] = 255; // permeability = 1.0 (vacuum)
      materialData[i + 1] = 255; // permittivity = 1.0 (vacuum)
      materialData[i + 2] = 0; // conductivity = 0 (no loss)
      materialData[i + 3] = 255; // unused - full alpha
    }

    this.device.queue.writeTexture(
      { texture: this.textures.get('materialField')! },
      materialData,
      { bytesPerRow: this.textureSize * 4 }, // rgba8unorm = 4 channels * 1 byte = 4 bytes per pixel
      { width: this.textureSize, height: this.textureSize }
    );
  }

  private initializeAlphaBeta() {
    const simParams = new Float32Array([this.dt, this.cellSize, 0, 0]);
    const simBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(simBuffer, 0, simParams);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('updateAlphaBeta')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('materialField')!.createView() },
        { binding: 1, resource: { buffer: simBuffer } },
        { binding: 2, resource: this.textures.get('alphaBetaField')!.createView() },
      ],
    });

    this.runComputePass('updateAlphaBeta', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));
  }

  createTexture(name: string, width: number, height: number, format: GPUTextureFormat = 'rgba16float') {
    const texture = this.device.createTexture({
      size: [width, height],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      label: `${name}_texture`,
    });
    this.textures.set(name, texture);
    return texture;
  }

  createBuffer(name: string, size: number, usage: GPUBufferUsageFlags) {
    const buffer = this.device.createBuffer({ size, usage });
    this.buffers.set(name, buffer);
    return buffer;
  }

  // Add a point charge source - Fixed to avoid circular reference
  addPointCharge(x: number, y: number, charge: number) {
    console.log(`Adding charge: x=${x}, y=${y}, charge=${charge}`);

    const nx = (x + 1) * 0.5; // Convert from [-1,1] to [0,1]
    const ny = (y + 1) * 0.5;

    console.log(`Normalized position: nx=${nx}, ny=${ny}`);

    const drawParams = new Float32Array([
      nx, ny, // position in [0,1] space
      0.05, 0.05, // smaller radius for point source
      0, 0, charge * 1.0, 0, // reduced charge magnitude for smoother propagation
      1, 1, 1, 1, // keep existing values (additive)
    ]);

    const paramsBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, drawParams);

    // Create temporary texture for drawing
    const tempTexture = this.device.createTexture({
      size: [this.textureSize, this.textureSize],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('drawEllipse')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('sourceField')!.createView() },
        { binding: 1, resource: { buffer: paramsBuffer } },
        { binding: 2, resource: tempTexture.createView() },
      ],
    });

    this.runComputePass('drawEllipse', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    // Copy result back to source field
    this.copyTexture(tempTexture, this.textures.get('sourceField')!);
    tempTexture.destroy();
    paramsBuffer.destroy();

    console.log('Charge added successfully');
  }

  private copyTexture(source: GPUTexture, destination: GPUTexture) {
    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyTextureToTexture(
      { texture: source },
      { texture: destination },
      [this.textureSize, this.textureSize]
    );
    this.device.queue.submit([commandEncoder.finish()]);
  }

  // Main simulation step - Fixed to match reference implementation
  step() {
    const dt = this.dt;

    // Step electric field (first half of time step)
    this.stepElectric(dt);

    // Step magnetic field (second half of time step) 
    this.stepMagnetic(dt);
  }

  private stepElectric(dt: number) {
    // Update alpha-beta if needed
    this.updateAlphaBetaFromMaterial(dt);

    // Inject sources into electric field
    this.injectSources();

    // Decay sources
    this.decaySources();

    // Update electric field
    this.updateElectricField();

    // Advance time by half step
    this.time += dt / 2;
  }

  private stepMagnetic(dt: number) {
    // Update magnetic field  
    this.updateMagneticField();

    // Advance time by half step
    this.time += dt / 2;
  }

  private updateAlphaBetaFromMaterial(dt: number) {
    // Only update if dt changed
    if (this.alphaBetaDt !== dt) {
      this.alphaBetaDt = dt;

      const simParams = new Float32Array([dt, this.cellSize, 0, 0]);
      const simBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(simBuffer, 0, simParams);

      const bindGroup = this.device.createBindGroup({
        layout: this.pipelines.get('updateAlphaBeta')!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.textures.get('materialField')!.createView() },
          { binding: 1, resource: { buffer: simBuffer } },
          { binding: 2, resource: this.textures.get('alphaBetaField')!.createView() },
        ],
      });

      this.runComputePass('updateAlphaBeta', bindGroup,
        Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

      simBuffer.destroy();
    }
  }

  private updateElectricField() {
    // Swap electric field buffers before writing
    this.swapElectricBuffers();

    const fieldParams = new Float32Array([
      1.0 / this.textureSize, 1.0 / this.textureSize, // relativeCellSize
      0, 0, // reflectiveBoundary = false, padding
    ]);

    const paramsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, fieldParams);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('updateElectric')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('electricFieldNext')!.createView() }, // Previous electric field
        { binding: 1, resource: this.textures.get('magneticField')!.createView() }, // Current magnetic field
        { binding: 2, resource: this.textures.get('alphaBetaField')!.createView() },
        { binding: 3, resource: { buffer: paramsBuffer } },
        { binding: 4, resource: this.textures.get('electricField')!.createView() }, // Write to current
      ],
    });

    this.runComputePass('updateElectric', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    paramsBuffer.destroy();
  }

  private updateMagneticField() {
    // Swap magnetic field buffers before writing
    this.swapMagneticBuffers();

    const fieldParams = new Float32Array([
      1.0 / this.textureSize, 1.0 / this.textureSize, // relativeCellSize
      0, 0, // reflectiveBoundary = false, padding
    ]);

    const paramsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, fieldParams);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('updateMagnetic')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('electricField')!.createView() }, // Current electric field
        { binding: 1, resource: this.textures.get('magneticFieldNext')!.createView() }, // Previous magnetic field
        { binding: 2, resource: this.textures.get('alphaBetaField')!.createView() },
        { binding: 3, resource: { buffer: paramsBuffer } },
        { binding: 4, resource: this.textures.get('magneticField')!.createView() }, // Write to current
      ],
    });

    this.runComputePass('updateMagnetic', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    paramsBuffer.destroy();
  }

  private injectSources() {
    // Swap source field buffers
    this.swapSourceBuffers();

    const sourceParams = new Float32Array([this.dt, 0, 0, 0]);
    const paramsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, sourceParams);

    // Create temporary texture for output
    const tempTexture = this.device.createTexture({
      size: [this.textureSize, this.textureSize],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('injectSource')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('sourceFieldNext')!.createView() }, // Previous source field
        { binding: 1, resource: this.textures.get('electricFieldNext')!.createView() }, // Previous electric field
        { binding: 2, resource: { buffer: paramsBuffer } },
        { binding: 3, resource: tempTexture.createView() },
      ],
    });

    this.runComputePass('injectSource', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    // Copy result back to current electric field
    this.copyTexture(tempTexture, this.textures.get('electricField')!);
    tempTexture.destroy();
    paramsBuffer.destroy();
  }

  private decaySources() {
    // Pre-compute decay factor: exp(-ln(1000) * dt) ≈ 0.001^dt (very fast decay to prevent unbounded growth)
    // With dt=0.001: decay ≈ 0.9931 per step, so after 1000 steps source field is ~0.37% of original
    const decayFactor = Math.exp(-Math.LN10 * 3.0 * this.dt);
    const decayParams = new Float32Array([decayFactor, 0, 0, 0]);
    const paramsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, decayParams);

    // Create temporary texture for decay operation
    const tempTexture = this.device.createTexture({
      size: [this.textureSize, this.textureSize],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.pipelines.get('decaySource')!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.textures.get('sourceFieldNext')!.createView() }, // Previous source field
        { binding: 1, resource: { buffer: paramsBuffer } },
        { binding: 2, resource: tempTexture.createView() },
      ],
    });

    this.runComputePass('decaySource', bindGroup,
      Math.ceil(this.textureSize / 8), Math.ceil(this.textureSize / 8));

    // Copy result back to current source field
    this.copyTexture(tempTexture, this.textures.get('sourceField')!);
    tempTexture.destroy();
    paramsBuffer.destroy();
  }

  private swapSourceBuffers() {
    // Swap source field buffers
    const temp = this.textures.get('sourceField');
    this.textures.set('sourceField', this.textures.get('sourceFieldNext')!);
    this.textures.set('sourceFieldNext', temp!);
  }

  private swapElectricBuffers() {
    // Swap electric field buffers
    const temp = this.textures.get('electricField');
    this.textures.set('electricField', this.textures.get('electricFieldNext')!);
    this.textures.set('electricFieldNext', temp!);
  }

  private swapMagneticBuffers() {
    // Swap magnetic field buffers
    const temp = this.textures.get('magneticField');
    this.textures.set('magneticField', this.textures.get('magneticFieldNext')!);
    this.textures.set('magneticFieldNext', temp!);
  }

  runComputePass(pipelineName: string, bindGroup: GPUBindGroup, workgroupsX: number, workgroupsY: number = 1, workgroupsZ: number = 1) {
    const pipeline = this.pipelines.get(pipelineName);
    if (!pipeline) throw new Error(`Pipeline ${pipelineName} not found`);

    const commandEncoder = this.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();

    computePass.setPipeline(pipeline);
    computePass.setBindGroup(0, bindGroup);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
    computePass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  getSampler() {
    return this.sampler;
  }

  getTexture(name: string) {
    return this.textures.get(name);
  }

  getBuffer(name: string) {
    return this.buffers.get(name);
  }

  getPipeline(name: string) {
    return this.pipelines.get(name);
  }

  getTime() {
    return this.time;
  }

  /**
   * Read the electric field value at a specific point (x, y in normalized [0,1] coordinates)
   * Returns a promise with [Ex, Ey, Ez, magnitude]
   */
  async readFieldValueAt(x: number, y: number): Promise<Float32Array> {
    // Serialize readback operations - only allow one at a time
    if (this.readbackInProgress) {
      return new Float32Array([0, 0, 0, 0]);
    }
    this.readbackInProgress = true;

    try {
      if (!this.readbackBuffer || !this.stagingBuffer) {
        throw new Error('Readback buffers not initialized');
      }

      // Ensure staging buffer is unmapped before use
      if (this.stagingBufferMapped) {
        try {
          this.stagingBuffer.unmap();
          this.stagingBufferMapped = false;
        } catch (e) {
          // Ignore unmap errors
        }
      }

      // Create parameters buffer with point coordinates
      const paramsData = new Float32Array([x, y, this.textureSize, 0]);
      const paramsBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

      // Create bind group for readFieldValue shader
      const pipeline = this.pipelines.get('readFieldValue');
      if (!pipeline) {
        throw new Error('readFieldValue pipeline not found');
      }

      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.textures.get('electricField')!.createView() },
          { binding: 1, resource: { buffer: this.readbackBuffer } },
          { binding: 2, resource: { buffer: paramsBuffer } },
        ],
      });

      // Run compute shader to read field value
      const commandEncoder = this.device.createCommandEncoder();
      const computePass = commandEncoder.beginComputePass();
      computePass.setPipeline(pipeline);
      computePass.setBindGroup(0, bindGroup);
      computePass.dispatchWorkgroups(1, 1, 1);
      computePass.end();

      // Copy from readback buffer to staging buffer
      commandEncoder.copyBufferToBuffer(
        this.readbackBuffer, 0,
        this.stagingBuffer, 0,
        16
      );

      this.device.queue.submit([commandEncoder.finish()]);
      paramsBuffer.destroy();

      // Wait for GPU to finish the submitted work before mapping
      await this.device.queue.onSubmittedWorkDone();

      // Map staging buffer and read data - with proper error handling
      try {
        await this.stagingBuffer.mapAsync(GPUMapMode.READ);
        this.stagingBufferMapped = true;

        const mappedData = this.stagingBuffer.getMappedRange();
        const data = new Float32Array(4);
        data.set(new Float32Array(mappedData));

        this.stagingBuffer.unmap();
        this.stagingBufferMapped = false;

        return data;
      } catch (error) {
        console.error('Failed to map staging buffer:', error);
        // Return zero field if readback fails
        return new Float32Array([0, 0, 0, 0]);
      }
    } finally {
      this.readbackInProgress = false;
    }
  }

  // Add cleanup method
  destroy() {
    // Unmap staging buffer if mapped
    if (this.stagingBufferMapped && this.stagingBuffer) {
      try {
        this.stagingBuffer.unmap();
      } catch (e) {
        // Ignore unmap errors during cleanup
      }
    }

    for (const texture of this.textures.values()) {
      texture.destroy();
    }
    for (const buffer of this.buffers.values()) {
      buffer.destroy();
    }
    if (this.readbackBuffer) {
      this.readbackBuffer.destroy();
    }
    if (this.stagingBuffer) {
      this.stagingBuffer.destroy();
    }
  }
}
