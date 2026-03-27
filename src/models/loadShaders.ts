type ShaderMap = Record<string, string>;

const computeShaderPaths: Record<string, string> = {
  updateAlphaBeta: '/shaders/compute/updateAlphaBeta.wgsl',
  updateElectric: '/shaders/compute/updateElectric.wgsl',
  updateMagnetic: '/shaders/compute/updateMagnetic.wgsl',
  injectSource: '/shaders/compute/injectSource.wgsl',
  decaySource: '/shaders/compute/decaySource.wgsl',
  drawSquare: '/shaders/compute/drawSquare.wgsl',
  drawEllipse: '/shaders/compute/drawEllipse.wgsl',
  readFieldValue: '/shaders/compute/readFieldValue.wgsl',
  readFieldValue3D: '/shaders/compute/readFieldValue3D.wgsl',
};

const renderShaderPaths: Record<string, string> = {
  fieldVertex: '/shaders/render/fieldVertex.wgsl',
  fieldFragment: '/shaders/render/fieldFragment.wgsl',
};

async function loadShaderText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load shader at ${path}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function loadShaderSet(paths: Record<string, string>): Promise<ShaderMap> {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([name, path]) => [name, await loadShaderText(path)] as const),
  );

  return Object.fromEntries(entries);
}

// Load all compute shaders from public/shaders/compute
export async function loadComputeShaders(): Promise<ShaderMap> {
  return loadShaderSet(computeShaderPaths);
}

// Load all render shaders from public/shaders/render
export async function loadRenderShaders(): Promise<ShaderMap> {
  return loadShaderSet(renderShaderPaths);
}

// Load all shaders
export async function loadAllShaders(): Promise<{ compute: ShaderMap; render: ShaderMap }> {
  return {
    compute: await loadComputeShaders(),
    render: await loadRenderShaders(),
  };
}
