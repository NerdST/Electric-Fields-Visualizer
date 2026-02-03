import * as THREE from 'three';
import { electricFieldAt } from '../models/Charge';
import type { Charge } from '../models/Charge';

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
    
    // Make arrows larger and more visible
    this.arrowGeometry = new THREE.ConeGeometry(0.1, 0.5, 8);
    this.arrowMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x00ff00,
      transparent: true,
      opacity: 0.9
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
    
    if (instanceCount === 0) {
      console.warn('VectorFieldRenderer: No grid points generated');
      return;
    }

    console.log(`VectorFieldRenderer: Creating vector field with ${instanceCount} arrows`);
    this.arrowMesh = new THREE.InstancedMesh(
      this.arrowGeometry,
      this.arrowMaterial,
      instanceCount
    );

    this.updateVectorField();
    this.scene.add(this.arrowMesh);
    console.log('VectorFieldRenderer: Arrow mesh added to scene, visible:', this.arrowMesh.visible);
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
    if (!this.arrowMesh) {
      console.warn('VectorFieldRenderer: arrowMesh is null in updateVectorField');
      return;
    }
    const gridPoints = this.gridPoints;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    let visibleCount = 0;
    for (let i = 0; i < gridPoints.length; i++) {
      const point = gridPoints[i];
      const fieldResult = electricFieldAt(point, this.charges);
      const field = fieldResult.field;

      if (field.length() < 1e-6) {
        // Hide arrow for zero/very small fields
        matrix.makeScale(0, 0, 0);
        this.arrowMesh.setMatrixAt(i, matrix);
        continue;
      }

      let arrowLength = field.length();
      if (this.config.showDirectionOnly) {
        arrowLength = 1.0; // Base arrow length for direction-only mode (scaled to geometry height 0.5)
      } else {
        // Scale field magnitude more reasonably
        const normalizedMagnitude = Math.min(arrowLength / this.config.maxFieldMagnitude, 1);
        // Ensure minimum visible size - scale relative to base geometry height (0.5)
        // arrowLength is a multiplier for the base geometry height of 0.5
        arrowLength = Math.max(normalizedMagnitude * this.config.arrowScale, 0.5);
      }

      position.copy(point);
      
      // Scale the arrow: base geometry height is 0.5, so scale by arrowLength
      scale.set(1, arrowLength, 1);
      
      const direction = field.clone().normalize();
      quaternion.setFromUnitVectors(this.upVector, direction);

      matrix.compose(position, quaternion, scale);
      this.arrowMesh.setMatrixAt(i, matrix);
      visibleCount++;
    }

    this.arrowMesh.instanceMatrix.needsUpdate = true;
    console.log(`VectorFieldRenderer: Updated ${visibleCount} visible arrows out of ${gridPoints.length} total`);
  }

  public updateCharges(charges: Charge[]) {
    this.charges = charges;
    
    // Ensure mesh exists
    if (!this.arrowMesh) {
      console.warn('VectorFieldRenderer: arrowMesh is null, recreating...');
      this.createVectorField();
      if (!this.arrowMesh) {
        console.error('VectorFieldRenderer: Failed to create arrow mesh');
        return;
      }
    }
    
    const wasVisible = this.arrowMesh.visible;
    const wasInScene = this.scene.children.includes(this.arrowMesh);
    
    this.updateVectorField();
    
    if (this.arrowMesh) {
      this.arrowMesh.visible = wasVisible;
      if (!wasInScene && wasVisible) {
        console.log('VectorFieldRenderer: Adding arrow mesh to scene in updateCharges');
        this.scene.add(this.arrowMesh);
      }
    }
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
      // Ensure mesh is in scene
      if (visible && !this.scene.children.includes(this.arrowMesh)) {
        console.log('VectorFieldRenderer: Adding arrow mesh to scene');
        this.scene.add(this.arrowMesh);
      }
    } else {
      console.warn('VectorFieldRenderer: arrowMesh is null! Cannot set visibility.');
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
    gridSize: 10, // Increased from 8 for better visibility
    bounds: {
      min: new THREE.Vector3(-5, -5, -5),
      max: new THREE.Vector3(5, 5, 5)
    },
    arrowScale: 1.0, // Adjusted for better scaling
    maxFieldMagnitude: 1e5, // Increased to handle larger fields
    showDirectionOnly: false
  };
}
