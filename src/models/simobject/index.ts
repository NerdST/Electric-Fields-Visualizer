/**
 * Public entry point for the SimObject system.
 *
 * Importing this module triggers registration side-effects for every built-in kind.
 * Slice B wires ThreeWorkspace to import from here.
 */

export type {
  SimObject,
  SimObjectBase,
  SimObjectKind,
  PointChargeObject,
} from './types';
export type { SimObjectRenderer } from './renderer';
export {
  type SimObjectDescriptor,
  register,
  getDescriptor,
  getAllDescriptors,
} from './registry';

// Side-effect imports: each module calls `register(...)` at load time.
import './PointCharge';

export { createDefaultPointCharge, pointChargeDescriptor } from './PointCharge';
