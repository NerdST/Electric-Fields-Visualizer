import * as THREE from 'three';
import type { Charge } from '../models/Charge';

export class ChargeMeshManager {
  private scene: THREE.Scene;
  private chargeMeshes: Map<string, THREE.Mesh> = new Map();
  private chargeGeometry: THREE.SphereGeometry;
  private positiveChargeMaterial: THREE.MeshStandardMaterial;
  private negativeChargeMaterial: THREE.MeshStandardMaterial;
  private selectedChargeId: string | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.chargeGeometry = new THREE.SphereGeometry(0.2, 16, 16);
    this.positiveChargeMaterial = new THREE.MeshStandardMaterial({ color: 0xff4444 });
    this.negativeChargeMaterial = new THREE.MeshStandardMaterial({ color: 0x4444ff });
  }

  public updateCharges(charges: Charge[], selectedChargeId: string | null = null): void {
    this.selectedChargeId = selectedChargeId;
    const seen: Set<string> = new Set();

    for (const charge of charges) {
      seen.add(charge.id);
      let mesh = this.chargeMeshes.get(charge.id);
      const desiredMaterial =
        charge.magnitude > 0 ? this.positiveChargeMaterial : this.negativeChargeMaterial;
      
      if (!mesh) {
        mesh = new THREE.Mesh(this.chargeGeometry, desiredMaterial);
        mesh.userData = { chargeId: charge.id };
        this.scene.add(mesh);
        this.chargeMeshes.set(charge.id, mesh);
      } else {
        const isPositive = mesh.material === this.positiveChargeMaterial;
        if ((isPositive && charge.magnitude < 0) || (!isPositive && charge.magnitude > 0)) {
          mesh.material = desiredMaterial;
        }
      }
      
      mesh.position.copy(charge.position);

      // Selection highlight
      mesh.scale.setScalar(this.selectedChargeId === charge.id ? 1.5 : 1.0);
      mesh.children
        .filter((c) => (c as any).isMesh)
        .forEach((child) => mesh && mesh.remove(child));
      
      if (this.selectedChargeId === charge.id) {
        const outlineGeometry = new THREE.SphereGeometry(0.25, 16, 16);
        const outlineMaterial = new THREE.MeshBasicMaterial({
          color: 0xffff00,
          wireframe: true,
          transparent: true,
          opacity: 0.8,
        });
        const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
        mesh.add(outline);
      }
    }

    // Remove meshes that no longer exist
    for (const [id, mesh] of Array.from(this.chargeMeshes.entries())) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.chargeMeshes.delete(id);
      }
    }
  }

  public getChargeMeshes(): THREE.Mesh[] {
    return Array.from(this.chargeMeshes.values());
  }

  public dispose(): void {
    for (const mesh of this.chargeMeshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.chargeMeshes.clear();
    this.chargeGeometry.dispose();
    this.positiveChargeMaterial.dispose();
    this.negativeChargeMaterial.dispose();
  }
}

