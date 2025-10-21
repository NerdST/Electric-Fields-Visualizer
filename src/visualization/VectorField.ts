import * as THREE from 'three';
import { electricFieldAt } from '../physics/Charge';
import type { Charge } from '../physics/Charge';

export interface VectorFieldConfig {
  gridSize: number;
  bounds: { min: THREE.Vector3; max: THREE.Vector3 };
  arrowScale: number;
  maxFieldMagnitude: number;
  showDirectionOnly: boolean;
}

export class VectorFieldRenderer {
  private scene: THREE.Scene;
  private arrowMesh: THREE.InstancedMesh | null = null;
  private arrowGeometry: THREE.ConeGeometry;
  private arrowMaterial: THREE.MeshBasicMaterial;
  private config: VectorFieldConfig;
  private charges: Charge[] = [];
  private gridPoints: THREE.Vector3[] = [];
  private readonly upVector: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, config: VectorFieldConfig) {
    this.scene = scene;
    this.config = config;
    
    this.arrowGeometry = new THREE.ConeGeometry(0.05, 0.2, 8);
    this.arrowMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x00ff00,
      transparent: true,
      opacity: 0.8
    });
    
    this.createVectorField();
  }

  private createVectorField() {
    if (this.arrowMesh) {
      this.scene.remove(this.arrowMesh);
      this.arrowMesh.dispose();
    }

    this.gridPoints = this.generateGridPoints();
    const instanceCount = this.gridPoints.length;
    
    if (instanceCount === 0) return;

    this.arrowMesh = new THREE.InstancedMesh(
      this.arrowGeometry,
      this.arrowMaterial,
      instanceCount
    );

    this.updateVectorField();
    this.scene.add(this.arrowMesh);
  }

  private generateGridPoints(): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const { min, max } = this.config.bounds;
    const step = (max.x - min.x) / this.config.gridSize;
    
    for (let x = 0; x < this.config.gridSize; x++) {
      for (let y = 0; y < this.config.gridSize; y++) {
        for (let z = 0; z < this.config.gridSize; z++) {
          const point = new THREE.Vector3(
            min.x + x * step,
            min.y + y * step,
            min.z + z * step
          );
          points.push(point);
        }
      }
    }
    
    return points;
  }

  private updateVectorField() {
    if (!this.arrowMesh) return;
    const gridPoints = this.gridPoints;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    for (let i = 0; i < gridPoints.length; i++) {
      const point = gridPoints[i];
      const fieldResult = electricFieldAt(point, this.charges);
      const field = fieldResult.field;

      if (field.length() < 1e-6) {
        matrix.makeScale(0, 0, 0);
        this.arrowMesh.setMatrixAt(i, matrix);
        continue;
      }

      let arrowLength = field.length();
      if (this.config.showDirectionOnly) {
        arrowLength = 0.3; 
      } else {
        // CHANGE: Scale field magnitude more reasonably
        const normalizedMagnitude = Math.min(arrowLength / this.config.maxFieldMagnitude, 1);
        arrowLength = Math.max(normalizedMagnitude * this.config.arrowScale, 0.1); // Minimize visible size
      }

      position.copy(point);
      
      scale.set(1, arrowLength, 1);
      
      const direction = field.clone().normalize();
      quaternion.setFromUnitVectors(this.upVector, direction);

      matrix.compose(position, quaternion, scale);
      this.arrowMesh.setMatrixAt(i, matrix);
    }

    this.arrowMesh.instanceMatrix.needsUpdate = true;
  }

  public updateCharges(charges: Charge[]) {
    this.charges = charges;
    this.updateVectorField();
  }

  public updateConfig(config: Partial<VectorFieldConfig>) {
    const nextConfig = { ...this.config, ...config };
    const oldGridPoints = this.gridPoints;
    const oldCount = oldGridPoints.length;
    this.config = nextConfig;
  
    this.gridPoints = this.generateGridPoints();
    const newCount = this.gridPoints.length;
    if (newCount !== oldCount || !this.arrowMesh) {
      this.createVectorField();
    } else {
      this.updateVectorField();
    }
  }

  public setVisible(visible: boolean) {
    console.log('VectorFieldRenderer.setVisible called with:', visible);
    if (this.arrowMesh) {
      console.log('Setting arrowMesh.visible to:', visible);
      this.arrowMesh.visible = visible;
    } else {
      console.log('arrowMesh is null!');
    }
  }

  public dispose() {
    if (this.arrowMesh) {
      this.scene.remove(this.arrowMesh);
      this.arrowMesh.dispose();
    }
    this.arrowGeometry.dispose();
    this.arrowMaterial.dispose();
  }
}

export function createDefaultVectorFieldConfig(): VectorFieldConfig {
  return {
    gridSize: 8,
    bounds: {
      min: new THREE.Vector3(-5, -5, -5),
      max: new THREE.Vector3(5, 5, 5)
    },
    arrowScale: 2.0,
    maxFieldMagnitude: 1e4,
    showDirectionOnly: false
  };
}
