// Import shaders as text using Vite's asset handling
import updateAlphaBetaShader from './compute/updateAlphaBeta.wgsl?raw';
import updateElectricShader from './compute/updateElectric.wgsl?raw';
import updateMagneticShader from './compute/updateMagnetic.wgsl?raw';
import injectSourceShader from './compute/injectSource.wgsl?raw';
import decaySourceShader from './compute/decaySource.wgsl?raw';
import drawSquareShader from './compute/drawSquare.wgsl?raw';
import drawEllipseShader from './compute/drawEllipse.wgsl?raw';
import readFieldValueShader from './compute/readFieldValue.wgsl?raw';
import fieldVertexShader from './render/fieldVertex.wgsl?raw';
import fieldFragmentShader from './render/fieldFragment.wgsl?raw';

// Load all compute shaders
export function loadComputeShaders() {
  return {
    updateAlphaBeta: updateAlphaBetaShader,
    updateElectric: updateElectricShader,
    updateMagnetic: updateMagneticShader,
    injectSource: injectSourceShader,
    decaySource: decaySourceShader,
    drawSquare: drawSquareShader,
    drawEllipse: drawEllipseShader,
    readFieldValue: readFieldValueShader
  };
}

// Load all render shaders
export function loadRenderShaders() {
  return {
    fieldVertex: fieldVertexShader,
    fieldFragment: fieldFragmentShader
  };
}

// Load all shaders
export function loadAllShaders() {
  return {
    compute: loadComputeShaders(),
    render: loadRenderShaders()
  };
}
