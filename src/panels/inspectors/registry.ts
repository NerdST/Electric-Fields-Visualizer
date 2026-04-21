import type React from 'react';
import type { SimObject, SimObjectKind } from '../../models/simobject';

export interface InspectorProps<T extends SimObject> {
  object: T;
  timeSeconds: number;
  update: (patch: Partial<T>) => void;
  onDelete?: () => void;
}

type AnyInspector = React.FC<InspectorProps<any>>;

const inspectorRegistry = new Map<SimObjectKind, AnyInspector>();

export function registerInspector<T extends SimObject>(
  kind: SimObjectKind,
  Component: React.FC<InspectorProps<T>>,
): void {
  inspectorRegistry.set(kind, Component as AnyInspector);
}

export function getInspector(kind: SimObjectKind): AnyInspector | undefined {
  return inspectorRegistry.get(kind);
}
