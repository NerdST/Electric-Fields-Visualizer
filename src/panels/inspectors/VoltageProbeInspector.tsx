import React from 'react';
import type { SimObject } from '../../models/simobject';
import type { InspectorProps } from './registry';

/**
 * Stub — a real VoltageProbeObject type doesn't exist yet. Slice D migrates
 * the legacy voltage-point flow to a SimObject and fills this inspector in.
 */
export const VoltageProbeInspector: React.FC<InspectorProps<SimObject>> = () => {
  return (
    <div style={{ fontSize: '11px', color: '#aaa' }}>
      Voltage probe inspector — pending Slice D migration.
    </div>
  );
};
