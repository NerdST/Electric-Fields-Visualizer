import * as THREE from 'three';
import type { VoltagePoint } from '../models/VoltagePoint';
import type { Charge } from '../models/Charge';
import { electricFieldAt } from '../models/Charge';

export class VoltagePointMeshManager {
  private scene: THREE.Scene;
  private voltagePointMeshes: Map<string, THREE.Mesh> = new Map();
  private voltagePointArrows: Map<string, THREE.Mesh[]> = new Map();
  private voltagePointGeometry: THREE.SphereGeometry;
  private voltagePointMaterial: THREE.MeshBasicMaterial;
  private voltageArrowGeometry: THREE.ConeGeometry;
  private voltageArrowMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.voltagePointGeometry = new THREE.SphereGeometry(0.15, 12, 12);
    this.voltagePointMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.8,
    });
    this.voltageArrowGeometry = new THREE.ConeGeometry(0.05, 0.2, 8);
    this.voltageArrowMaterial = new THREE.MeshBasicMaterial({
      color: 0x4444ff,
      transparent: true,
      opacity: 0.8,
    });
  }

  public updateVoltagePoints(voltagePoints: VoltagePoint[], charges: Charge[]): void {
    const seen: Set<string> = new Set();
    const upVector = new THREE.Vector3(0, 1, 0);
    const sphereRadius = 0.15;
    const arrowScale = 2.0;
    const maxFieldMagnitude = 1e4;

    // Generate points around each voltage orb in a small grid
    const gridSize = 3; // 3x3x3 grid around each orb
    const gridStep = 0.4; // Distance between grid points
    const gridOffset = -(gridSize - 1) * gridStep / 2;

    // Update existing and create missing
    for (const point of voltagePoints) {
      seen.add(point.id);
      let mesh = this.voltagePointMeshes.get(point.id);
      
      if (!mesh) {
        mesh = new THREE.Mesh(this.voltagePointGeometry, this.voltagePointMaterial);
        mesh.userData = { voltagePointId: point.id };
        this.scene.add(mesh);
        this.voltagePointMeshes.set(point.id, mesh);
      }
      mesh.position.copy(point.position);

      // Create or update arrows for this voltage point
      let arrows = this.voltagePointArrows.get(point.id);
      
      // Calculate positions for arrows around the orb
      const arrowPositions: THREE.Vector3[] = [];
      for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
          for (let z = 0; z < gridSize; z++) {
            // Skip the center position (where the orb is)
            if (x === 1 && y === 1 && z === 1) continue;
            
            const offset = new THREE.Vector3(
              gridOffset + x * gridStep,
              gridOffset + y * gridStep,
              gridOffset + z * gridStep
            );
            const arrowPos = point.position.clone().add(offset);
            
            // Only add arrows that are at a reasonable distance from the orb
            const distance = offset.length();
            if (distance > sphereRadius && distance < sphereRadius + 0.6) {
              arrowPositions.push(arrowPos);
            }
          }
        }
      }

      // Remove old arrows if count changed
      if (arrows && arrows.length !== arrowPositions.length) {
        for (const arrow of arrows) {
          this.scene.remove(arrow);
          arrow.geometry.dispose();
          (arrow.material as THREE.Material).dispose();
        }
        arrows = undefined;
        this.voltagePointArrows.delete(point.id);
      }

      if (!arrows) {
        arrows = [];
        for (let i = 0; i < arrowPositions.length; i++) {
          const arrow = new THREE.Mesh(this.voltageArrowGeometry, this.voltageArrowMaterial);
          arrow.scale.set(1, 1, 1);
          this.scene.add(arrow);
          arrows.push(arrow);
        }
        this.voltagePointArrows.set(point.id, arrows);
      }

      // Update arrow positions and orientations based on electric field
      for (let i = 0; i < arrowPositions.length && i < arrows.length; i++) {
        const arrow = arrows[i];
        const arrowPos = arrowPositions[i];
        
        // Calculate electric field at this position
        const fieldResult = electricFieldAt(arrowPos, charges);
        const field = fieldResult.field;
        
        let arrowLength = field.length();
        
        if (field.length() < 1e-6) {
          // Hide arrow if field is too small
          arrow.scale.set(0, 0, 0);
          continue;
        }

        const normalizedMagnitude = Math.min(arrowLength / maxFieldMagnitude, 1);
        arrowLength = Math.max(normalizedMagnitude * arrowScale, 0.1);

        // Position arrow at the grid position (same as vector field)
        arrow.position.copy(arrowPos);
        
        // Orient arrow in field direction
        const direction = field.clone().normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, direction);
        arrow.setRotationFromQuaternion(quaternion);
        
        // Scale arrow (length along Y axis) - exactly like vector field
        arrow.scale.set(1, arrowLength, 1);
      }
    }

    // Remove meshes and arrows that no longer have voltage points
    for (const [id, mesh] of Array.from(this.voltagePointMeshes.entries())) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.voltagePointMeshes.delete(id);

        const arrows = this.voltagePointArrows.get(id);
        if (arrows) {
          for (const arrow of arrows) {
            this.scene.remove(arrow);
            arrow.geometry.dispose();
            (arrow.material as THREE.Material).dispose();
          }
          this.voltagePointArrows.delete(id);
        }
      }
    }
  }

  public getVoltagePointMeshes(): THREE.Mesh[] {
    return Array.from(this.voltagePointMeshes.values());
  }

  public dispose(): void {
    for (const mesh of this.voltagePointMeshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.voltagePointMeshes.clear();

    for (const arrows of this.voltagePointArrows.values()) {
      for (const arrow of arrows) {
        this.scene.remove(arrow);
        arrow.geometry.dispose();
        (arrow.material as THREE.Material).dispose();
      }
    }
    this.voltagePointArrows.clear();

    this.voltagePointGeometry.dispose();
    this.voltagePointMaterial.dispose();
    this.voltageArrowGeometry.dispose();
    this.voltageArrowMaterial.dispose();
  }
}

