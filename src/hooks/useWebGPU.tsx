// import { useEffect, useState } from 'react';

// interface WebGPUState {
//   device: GPUDevice | null;
//   isReady: boolean;
//   error: string | null;
// }

// /**
//  * Custom React Hook to initialize and manage a WebGPU device.
//  * @returns {WebGPUState} An object containing the GPUDevice, readiness state, and any error.
//  */
// export function useWebGPU(): WebGPUState {
//   const [webGPUState, setWebGPUState] = useState<WebGPUState>({
//     device: null,
//     isReady: false,
//     error: null,
//   });

//   useEffect(() => {
//     const initDevice = async () => {
//       if (!navigator.gpu) {
//         setWebGPUState(prev => ({ ...prev, error: "WebGPU not supported on this browser.", isReady: true }));
//         return;
//       }

//       try {
//         const adapter = await navigator.gpu.requestAdapter();
//         if (!adapter) {
//           setWebGPUState(prev => ({ ...prev, error: "No WebGPU adapter found.", isReady: true }));
//           return;
//         }

//         const device = await adapter.requestDevice();
//         device.lost.then((info) => {
//           console.error(`WebGPU device lost: ${info.message}`);
//           setWebGPUState({ device: null, isReady: false, error: "WebGPU device lost." });
//           // You might want to re-initialize here or alert the user
//         });

//         setWebGPUState({ device, isReady: true, error: null });
//       } catch (err) {
//         console.error("Failed to initialize WebGPU:", err);
//         setWebGPUState(prev => ({ ...prev, error: `Failed to initialize WebGPU: ${err instanceof Error ? err.message : String(err)}`, isReady: true }));
//       }
//     };

//     if (!webGPUState.isReady && !webGPUState.error && !webGPUState.device) {
//       initDevice();
//     }

//     // Cleanup function: release GPU resources when the component unmounts
//     return () => {
//       // In a real app, you might want to consider when to destroy the device.
//       // For a global app device, you might not destroy it on component unmount,
//       // but rather when the app fully shuts down. However, good to know this pattern.
//       // E.g., device?.destroy(); // If you want to explicitly destroy it
//     };
//   }, [webGPUState.isReady, webGPUState.error, webGPUState.device]); // Dependencies for useEffect

//   return webGPUState;
// }

