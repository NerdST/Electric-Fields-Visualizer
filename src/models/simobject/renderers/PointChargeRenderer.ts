import * as THREE from 'three';
import type { PointChargeObject } from '../types';
import type { SimObjectRenderer } from '../renderer';
import { evaluateWaveform } from '../../SimulationSource';

/**
 * Renders point charges as colored spheres with a wireframe outline when selected.
 * Ported from the module-level `updateChargeMeshes` in ThreeWorkspace.tsx
 * (the old module globals `chargeMeshes`, `chargeGeometry`, etc. are now encapsulated here).
 */
export class PointChargeRenderer implements SimObjectRenderer<PointChargeObject> {
  private readonly scene: THREE.Scene;
  private readonly meshes = new Map<string, THREE.Mesh>();

  private readonly geometry = new THREE.SphereGeometry(0.2, 16, 16);
  private readonly positiveMaterial = new THREE.MeshStandardMaterial({ color: 0xff4444 });
  private readonly negativeMaterial = new THREE.MeshStandardMaterial({ color: 0x4444ff });
  private readonly outlineGeometry = new THREE.SphereGeometry(0.25, 16, 16);
  private readonly outlineMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    wireframe: true,
    transparent: true,
    opacity: 0.8,
  });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public sync(objects: PointChargeObject[], selectedId: string | null, timeSeconds: number): void {
    const seen = new Set<string>();

    for (const obj of objects) {
      seen.add(obj.id);
      const magnitude = evaluateWaveform(obj.waveform, timeSeconds);
      const desiredMaterial = magnitude >= 0 ? this.positiveMaterial : this.negativeMaterial;

      let mesh = this.meshes.get(obj.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometry, desiredMaterial);
        mesh.userData = { simObjectId: obj.id };
        this.scene.add(mesh);
        this.meshes.set(obj.id, mesh);
      } else if (mesh.material !== desiredMaterial) {
        mesh.material = desiredMaterial;
      }

      mesh.position.copy(obj.position);
      mesh.visible = obj.visible;

      const isSelected = selectedId === obj.id;
      if (mesh.userData.outlined !== isSelected) {
        for (const child of [...mesh.children]) {
          if ((child as THREE.Mesh).isMesh) mesh.remove(child);
        }
        if (isSelected) {
          mesh.add(new THREE.Mesh(this.outlineGeometry, this.outlineMaterial));
        }
        mesh.userData.outlined = isSelected;
      }
      mesh.scale.setScalar(isSelected ? 1.5 : 1.0);
    }

    for (const [id, mesh] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.meshes.delete(id);
      }
    }
  }

  public getSelectableMeshes(): THREE.Object3D[] {
    return Array.from(this.meshes.values());
  }

  public dispose(): void {
    for (const mesh of this.meshes.values()) {
      this.scene.remove(mesh);
    }
    this.meshes.clear();
    this.geometry.dispose();
    this.positiveMaterial.dispose();
    this.negativeMaterial.dispose();
    this.outlineGeometry.dispose();
    this.outlineMaterial.dispose();
  }
}
