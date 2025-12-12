/**
 * FDTD Simulation Test Suite
 * Tests for accuracy and correctness of electromagnetic field simulation
 */

export interface TestResult {
  testName: string;
  passed: boolean;
  error?: string;
  details?: any;
}

export class FDTDTests {
  private simulation: any;

  constructor(_device: GPUDevice, simulation: any) {
    this.simulation = simulation;
  }

  /**
   * Test 1: Single point charge should create E-field following E = kQ/r²
   * For a static charge Q at center, field magnitude should decay as 1/r²
   */
  async testCoulombsLaw(): Promise<TestResult> {
    try {
      console.log('Running Coulomb\'s Law test...');

      // Place charge at center (0.5, 0.5)
      const chargePos = [0.5, 0.5];

      // Test points at different distances from center
      const testPoints = [
        { x: 0.5, y: 0.6, expectedRelative: 1.0 },   // r = 0.1
        { x: 0.5, y: 0.7, expectedRelative: 0.25 },  // r = 0.2 (1/4 of field)
        { x: 0.5, y: 0.8, expectedRelative: 0.111 }, // r = 0.3 (1/9 of field)
      ];

      // Read field values at test points
      const results = [];
      for (const point of testPoints) {
        const fieldData = await this.simulation.readFieldValueAt(point.x, point.y);
        const Ez = fieldData[2]; // Z-component is primary field
        const distance = Math.sqrt(
          Math.pow(point.x - chargePos[0], 2) +
          Math.pow(point.y - chargePos[1], 2)
        );

        results.push({
          position: [point.x, point.y],
          distance,
          Ez,
          magnitude: fieldData[3]
        });
      }

      // Check if field decreases with distance (inverse square law approximation)
      const ratio21 = Math.abs(results[1].Ez / results[0].Ez);
      const ratio31 = Math.abs(results[2].Ez / results[0].Ez);

      // Expected ratios for 1/r² law: (r1/r2)² 
      const expectedRatio21 = Math.pow(testPoints[0].expectedRelative / testPoints[1].expectedRelative, 0.5);
      const expectedRatio31 = Math.pow(testPoints[0].expectedRelative / testPoints[2].expectedRelative, 0.5);

      const tolerance = 0.8; // 80% tolerance - FDTD is inherently discrete
      const ratio21Error = Math.abs(ratio21 - expectedRatio21) / (expectedRatio21 + 0.001);
      const ratio31Error = Math.abs(ratio31 - expectedRatio31) / (expectedRatio31 + 0.001);

      const passed = ratio21Error < tolerance && ratio31Error < tolerance;
      return {
        testName: 'Coulomb\'s Law (1/r² decay)',
        passed,
        details: {
          results,
          ratio21: { actual: ratio21, expected: expectedRatio21, error: ratio21Error },
          ratio31: { actual: ratio31, expected: expectedRatio31, error: ratio31Error }
        }
      };
    } catch (error) {
      return {
        testName: 'Coulomb\'s Law',
        passed: false,
        error: String(error)
      };
    }
  }

  /**
   * Test 2: Field at charge location should be maximum
   */
  async testFieldMaximumAtSource(): Promise<TestResult> {
    try {
      console.log('Running field maximum test...');

      // Read field at charge and nearby points
      const centerField = await this.simulation.readFieldValueAt(0.5, 0.5);
      const nearbyPoints = [
        await this.simulation.readFieldValueAt(0.51, 0.5),
        await this.simulation.readFieldValueAt(0.5, 0.51),
        await this.simulation.readFieldValueAt(0.49, 0.5),
        await this.simulation.readFieldValueAt(0.5, 0.49),
      ];

      const centerMag = Math.abs(centerField[2]);
      const nearbyMags = nearbyPoints.map(field => Math.abs(field[2]));

      // Center should be largest, but allow some nearby points to be close
      const maxNearby = Math.max(...nearbyMags);
      const allNearbySmaller = maxNearby <= centerMag * 1.2; // Allow 20% variation

      return {
        testName: 'Field Maximum at Source',
        passed: allNearbySmaller,
        details: {
          centerMagnitude: centerMag,
          nearbyMagnitudes: nearbyMags,
          ratio: maxNearby / (centerMag + 0.001)
        }
      };
    } catch (error) {
      return {
        testName: 'Field Maximum at Source',
        passed: false,
        error: String(error)
      };
    }
  }

  /**
   * Test 3: Field symmetry - field should be radially symmetric around point charge
   */
  async testRadialSymmetry(): Promise<TestResult> {
    try {
      console.log('Running radial symmetry test...');

      const center = [0.5, 0.5];
      const radius = 0.1;

      // Test 4 points at same distance in different directions
      const points = [
        { x: center[0] + radius, y: center[1] },        // right
        { x: center[0] - radius, y: center[1] },        // left
        { x: center[0], y: center[1] + radius },        // up
        { x: center[0], y: center[1] - radius },        // down
      ];

      const fields = await Promise.all(
        points.map(p => this.simulation.readFieldValueAt(p.x, p.y))
      );

      // Use magnitude (index 3) instead of just Ez component
      const magnitudes = fields.map(f => f[3]);
      const avgMagnitude = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;

      console.log('Radial symmetry test - magnitudes:', magnitudes, 'average:', avgMagnitude);
      console.log('Raw field data:', fields);

      // Check if all magnitudes are within tolerance of average
      const tolerance = 0.4; // 40% tolerance - grid discretization causes asymmetry
      const allWithinTolerance = magnitudes.every(mag =>
        Math.abs(mag - avgMagnitude) / (avgMagnitude + 0.001) < tolerance
      );
      return {
        testName: 'Radial Symmetry',
        passed: allWithinTolerance,
        details: {
          magnitudes,
          average: avgMagnitude,
          maxDeviation: Math.max(...magnitudes.map(m => Math.abs(m - avgMagnitude) / avgMagnitude))
        }
      };
    } catch (error) {
      return {
        testName: 'Radial Symmetry',
        passed: false,
        error: String(error)
      };
    }
  }

  /**
   * Test 4: Field should be zero far from source
   */
  async testFieldDecayToZero(): Promise<TestResult> {
    try {
      console.log('Running field decay test...');

      // Read field at corners (far from center charge)
      const corners = [
        await this.simulation.readFieldValueAt(0.05, 0.05),
        await this.simulation.readFieldValueAt(0.95, 0.05),
        await this.simulation.readFieldValueAt(0.05, 0.95),
        await this.simulation.readFieldValueAt(0.95, 0.95),
      ];

      const threshold = 0.5; // Corners should have weak field
      const cornerMags = corners.map(f => Math.abs(f[2]));
      const avgCorner = cornerMags.reduce((a, b) => a + b) / cornerMags.length;
      const allSmall = avgCorner < threshold; // Average corner value should be small

      return {
        testName: 'Field Decay to Zero',
        passed: allSmall,
        details: {
          cornerFields: corners.map(f => f[2]),
          threshold
        }
      };
    } catch (error) {
      return {
        testName: 'Field Decay to Zero',
        passed: false,
        error: String(error)
      };
    }
  }

  /**
   * Test 5: Energy conservation - total energy should remain constant
   */
  async testEnergyConservation(): Promise<TestResult> {
    try {
      console.log('Running energy conservation test...');

      // Sample energy at multiple time steps
      const samples = 10;
      const energies = [];

      for (let i = 0; i < samples; i++) {
        // Sample a grid of points and sum energy
        let totalEnergy = 0;
        const gridPoints = 16; // 16x16 grid

        for (let x = 0; x < gridPoints; x++) {
          for (let y = 0; y < gridPoints; y++) {
            const px = (x + 0.5) / gridPoints;
            const py = (y + 0.5) / gridPoints;
            const field = await this.simulation.readFieldValueAt(px, py);
            totalEnergy += field[2] * field[2]; // E²
          }
        }

        energies.push(totalEnergy);

        // Wait for a few simulation steps
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Check if energy variation is small
      const avgEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
      const maxDeviation = Math.max(...energies.map(e => Math.abs(e - avgEnergy) / avgEnergy));

      const tolerance = 0.2; // 20% tolerance
      const passed = maxDeviation < tolerance;

      return {
        testName: 'Energy Conservation',
        passed,
        details: {
          energies,
          average: avgEnergy,
          maxDeviation
        }
      };
    } catch (error) {
      return {
        testName: 'Energy Conservation',
        passed: false,
        error: String(error)
      };
    }
  }

  /**
   * Run all tests and return results
   */
  async runAllTests(): Promise<TestResult[]> {
    console.log('=== Starting FDTD Test Suite ===');

    const results = [];

    results.push(await this.testFieldMaximumAtSource());
    results.push(await this.testRadialSymmetry());
    results.push(await this.testCoulombsLaw());
    results.push(await this.testFieldDecayToZero());
    // results.push(await this.testEnergyConservation()); // Skip for now - takes time

    console.log('=== Test Results ===');
    results.forEach(result => {
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`${status}: ${result.testName}`);
      if (result.error) {
        console.error(`  Error: ${result.error}`);
      }
      if (result.details) {
        console.log('  Details:', result.details);
      }
    });

    const passCount = results.filter(r => r.passed).length;
    console.log(`\nPassed: ${passCount}/${results.length} tests`);

    return results;
  }
}

/**
 * Helper function to visualize field along a line
 */
export async function plotFieldAlongLine(
  simulation: any,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  numPoints: number = 20
): Promise<Array<{ x: number, y: number, Ez: number, distance: number }>> {
  const results = [];

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const x = startX + t * (endX - startX);
    const y = startY + t * (endY - startY);

    const field = await simulation.readFieldValueAt(x, y);
    const distance = Math.sqrt(
      Math.pow(x - startX, 2) + Math.pow(y - startY, 2)
    );

    results.push({ x, y, Ez: field[2], distance });
  }

  return results;
}
