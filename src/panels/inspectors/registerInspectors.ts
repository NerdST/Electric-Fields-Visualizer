import { registerInspector } from './registry';
import { PointChargeInspector } from './PointChargeInspector';
import { VoltageProbeInspector } from './VoltageProbeInspector';

// Importing this module registers every inspector for side effect. Pulled in by
// panels/InspectorPanel.tsx so consumers don't have to remember.
registerInspector('pointCharge', PointChargeInspector);
registerInspector('voltageProbe', VoltageProbeInspector);
