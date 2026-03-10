import * as THREE from 'three';
import { electricFieldAt } from '../models/Charge';
import type { Charge } from '../models/Charge';

export interface FieldLineConfig {
  stepSize: number; // Step size for numerical integration
  maxSteps: number; // Maximum number of steps per line
  minStepSize: number; // Minimum step size (for adaptive stepping)
  bounds: { min: THREE.Vector3; max: THREE.Vector3 };
  lineWidth: number;
  color: number;
  opacity: number;
  linesPerCharge: number; // Number of field lines to start from each positive charge
}

export class FieldLineRenderer {
  private scene: THREE.Scene;
  private fieldLines: THREE.Line[] = [];
  private config: FieldLineConfig;
  private charges: Charge[] = [];
  private lineGroup: THREE.Group;

  constructor(scene: THREE.Scene, config: FieldLineConfig) {
    this.scene = scene;
    this.config = config;
    this.lineGroup = new THREE.Group();
    this.scene.add(this.lineGroup);
    this.createFieldLines();
  }

  /**
   * Runge-Kutta 4th order integration step
   * Traces one step along the field line
   */
  private rk4Step(
    position: THREE.Vector3,
    charges: Charge[],
    stepSize: number
  ): THREE.Vector3 {
    const k1 = this.getFieldDirection(position, charges);
    if (k1.lengthSq() < 1e-12) return position.clone();

    const k2Pos = position.clone().add(k1.clone().multiplyScalar(stepSize * 0.5));
    const k2 = this.getFieldDirection(k2Pos, charges);

    const k3Pos = position.clone().add(k2.clone().multiplyScalar(stepSize * 0.5));
    const k3 = this.getFieldDirection(k3Pos, charges);

    const k4Pos = position.clone().add(k3.clone().multiplyScalar(stepSize));
    const k4 = this.getFieldDirection(k4Pos, charges);

    // Weighted average (clone vectors to avoid mutation)
    const weightedDirection = k1
      .clone()
      .add(k2.clone().multiplyScalar(2))
      .add(k3.clone().multiplyScalar(2))
      .add(k4)
      .multiplyScalar(stepSize / 6);

    return position.clone().add(weightedDirection);
  }

  /**
   * Get normalized field direction at a point
   */
  private getFieldDirection(position: THREE.Vector3, charges: Charge[]): THREE.Vector3 {
    const fieldResult = electricFieldAt(position, charges);
    const field = fieldResult.field;
    const magnitude = field.length();
    
    if (magnitude < 1e-6) {
      return new THREE.Vector3(0, 0, 0);
    }
    
    return field.normalize();
  }

  /**
   * Check if position is within bounds
   */
  private isWithinBounds(position: THREE.Vector3): boolean {
    const { min, max } = this.config.bounds;
    return (
      position.x >= min.x && position.x <= max.x &&
      position.y >= min.y && position.y <= max.y &&
      position.z >= min.z && position.z <= max.z
    );
  }

  /**
   * Check if position is near a charge (within threshold)
   */
  private isNearCharge(position: THREE.Vector3, charges: Charge[], threshold: number = 0.2): Charge | null {
    for (const charge of charges) {
      const distance = position.distanceTo(charge.position);
      if (distance < threshold) {
        return charge;
      }
    }
    return null;
  }

  /**
   * Trace a single field line starting from a given position
   */
  private traceFieldLine(
    startPosition: THREE.Vector3,
    charges: Charge[],
    forward: boolean = true
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    let currentPos = startPosition.clone();
    let stepSize = this.config.stepSize;
    const direction = forward ? 1 : -1;

    points.push(currentPos.clone());

    for (let step = 0; step < this.config.maxSteps; step++) {
      // Check if we're out of bounds
      if (!this.isWithinBounds(currentPos)) {
        break;
      }

      // Check if we've reached a charge
      const nearbyCharge = this.isNearCharge(currentPos, charges);
      if (nearbyCharge) {
        // If we hit a negative charge, we've reached the end
        if (nearbyCharge.magnitude < 0 && forward) {
          points.push(nearbyCharge.position.clone());
          break;
        }
        // If we hit a positive charge going backward, we've reached the start
        if (nearbyCharge.magnitude > 0 && !forward) {
          break;
        }
      }

      // Take a step
      const nextPos = this.rk4Step(currentPos, charges, stepSize * direction);
      
      // Adaptive step sizing based on field strength
      const fieldResult = electricFieldAt(currentPos, charges);
      const fieldMagnitude = fieldResult.field.length();
      
      if (fieldMagnitude > 1e6) {
        // Strong field - use smaller steps
        stepSize = Math.max(this.config.minStepSize, stepSize * 0.5);
      } else if (fieldMagnitude < 1e3) {
        // Weak field - can use larger steps
        stepSize = Math.min(this.config.stepSize * 2, stepSize * 1.1);
      }

      // Check if step is too small (converged or stuck)
      if (currentPos.distanceTo(nextPos) < 1e-6) {
        break;
      }

      currentPos = nextPos;
      points.push(currentPos.clone());
    }

    return points;
  }

  /**
   * Generate starting points around a positive charge
   */
  private generateStartPoints(charge: Charge, count: number): THREE.Vector3[] {
    const startPoints: THREE.Vector3[] = [];
    const radius = 0.3; // Start slightly away from the charge

    // Generate points on a sphere around the charge
    for (let i = 0; i < count; i++) {
      // Use spherical coordinates for even distribution
      const theta = Math.acos(1 - (2 * i) / count); // Polar angle
      const phi = Math.PI * (1 + Math.sqrt(5)) * i; // Golden angle for even distribution

      const x = radius * Math.sin(theta) * Math.cos(phi);
      const y = radius * Math.sin(theta) * Math.sin(phi);
      const z = radius * Math.cos(theta);

      const startPoint = charge.position.clone().add(new THREE.Vector3(x, y, z));
      startPoints.push(startPoint);
    }

    return startPoints;
  }

  /**
   * Create all field lines
   */
  private createFieldLines() {
    this.clearFieldLines();

    if (this.charges.length === 0) {
      return;
    }

    // Find positive charges (field lines start from positive charges)
    const positiveCharges = this.charges.filter(c => c.magnitude > 0);

    if (positiveCharges.length === 0) {
      return;
    }

    // Create field lines from each positive charge
    for (const charge of positiveCharges) {
      const startPoints = this.generateStartPoints(charge, this.config.linesPerCharge);

      for (const startPoint of startPoints) {
        // Trace forward (away from positive charge)
        const forwardPoints = this.traceFieldLine(startPoint, this.charges, true);
        
        // Trace backward (toward positive charge) and reverse
        const backwardPoints = this.traceFieldLine(startPoint, this.charges, false);
        backwardPoints.reverse();

        // Combine backward and forward points
        const allPoints = [...backwardPoints, ...forwardPoints.slice(1)];

        if (allPoints.length < 2) {
          continue; // Need at least 2 points for a line
        }

        // Create the curve
        const geometry = new THREE.BufferGeometry().setFromPoints(allPoints);
        const material = new THREE.LineBasicMaterial({
          color: this.config.color,
          linewidth: this.config.lineWidth,
          transparent: true,
          opacity: this.config.opacity,
        });

        const line = new THREE.Line(geometry, material);
        this.fieldLines.push(line);
        this.lineGroup.add(line);
      }
    }
  }

  /**
   * Clear all existing field lines
   */
  private clearFieldLines() {
    for (const line of this.fieldLines) {
      this.lineGroup.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.fieldLines = [];
  }

  /**
   * Update charges and regenerate field lines
   */
  public updateCharges(charges: Charge[]) {
    this.charges = charges;
    this.createFieldLines();
  }

  /**
   * Set visibility of field lines
   */
  public setVisible(visible: boolean) {
    this.lineGroup.visible = visible;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<FieldLineConfig>) {
    this.config = { ...this.config, ...config };
    this.createFieldLines();
  }

  /**
   * Dispose of resources
   */
  public dispose() {
    this.clearFieldLines();
    this.scene.remove(this.lineGroup);
  }
}

export function createDefaultFieldLineConfig(): FieldLineConfig {
  return {
    stepSize: 0.1,
    maxSteps: 1000,
    minStepSize: 0.01,
    bounds: {
      min: new THREE.Vector3(-5, -5, -5),
      max: new THREE.Vector3(5, 5, 5)
    },
    lineWidth: 2,
    color: 0xffff00, // Yellow
    opacity: 0.8,
    linesPerCharge: 8, // Number of field lines per positive charge
  };
}
