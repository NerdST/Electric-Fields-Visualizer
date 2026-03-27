import { FDTDSimulation } from '../models/FDTDSimulation';

export class FDTDTests {
    private readonly device: GPUDevice;
    private readonly simulation: FDTDSimulation;

    constructor(device: GPUDevice, simulation: FDTDSimulation) {
        this.device = device;
        this.simulation = simulation;
    }

    async runAllTests(): Promise<void> {
        console.warn('FDTDTests.runAllTests() is a placeholder and should be replaced with real validation tests.');
        await this.device.queue.onSubmittedWorkDone();
        void this.simulation;
    }
}
