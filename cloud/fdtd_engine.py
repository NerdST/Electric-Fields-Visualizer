"""
FDTD Engine — mirrors the WebGPU implementation in FDTDSimulation.ts / updateElectric.wgsl.

Physics (2D Yee grid, leapfrog, TM-like with full Ex/Ey/Ez + Hx/Hy/Hz):

E update (backward differences, matches updateElectric.wgsl):
  Ex[i,j] = alpha_e * Ex[i,j] + beta_e * (Hz[i,j]   - Hz[i,j-1])
  Ey[i,j] = alpha_e * Ey[i,j] + beta_e * (Hz[i-1,j] - Hz[i,j])
  Ez[i,j] = alpha_e * Ez[i,j] + beta_e * ((Hy[i,j] - Hy[i-1,j]) - (Hx[i,j] - Hx[i,j-1]))

H update (forward differences, matches updateMagnetic.wgsl):
  Hx[i,j] = alpha_m * Hx[i,j] - beta_m * (Ez[i,j+1] - Ez[i,j])
  Hy[i,j] = alpha_m * Hy[i,j] + beta_m * (Ez[i+1,j] - Ez[i,j])
  Hz[i,j] = alpha_m * Hz[i,j] - beta_m * ((Ey[i+1,j] - Ey[i,j]) - (Ex[i,j+1] - Ex[i,j]))

Boundary: periodic (np.roll wraps around, same as wrapIndex in WGSL).
Sources:  static point charges constrain Ez at their pixel each step (Dirichlet BC).
          oscillating sources add amplitude*sin(2*pi*f*t + phase) to Ez.

Optional GPU acceleration: swap `import numpy as np` for `import cupy as np` at top.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional

try:
    import cupy as _cupy
    _cupy.zeros(1)  # trigger CUDA init — fails here if no GPU, not buried in a request
    import cupy as np
    _USING_GPU = True
except Exception:
    import numpy as np  # type: ignore
    _USING_GPU = False


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class StaticCharge:
    """A Dirichlet point source. nx,ny in [0,1]; magnitude in the same units
    the TS side passes (magnitude * 1e6, clamped to ±10)."""
    nx: float
    ny: float
    magnitude: float
    # Pre-computed pixel coordinates (set in FDTDEngine.set_charges)
    px: int = 0
    py: int = 0
    # Source mask: pixels within the 5%-radius ellipse around px,py
    mask: Optional[object] = field(default=None, repr=False)


@dataclass
class OscillatingSource:
    """An oscillating source. nx,ny in [0,1]."""
    nx: float
    ny: float
    radius: float
    amplitude: float
    frequency: float
    phase: float


# ---------------------------------------------------------------------------
# FDTD Engine
# ---------------------------------------------------------------------------

class FDTDEngine:
    """
    2-D FDTD with full 3-component E/H fields.

    Grid layout: field[x_index, y_index]   (same as texture coord in WGSL).
    """

    LIGHT_SPEED: float = 299_792_458.0
    COURANT: float = 0.5
    MAX_FIELD: float = 1e6

    def __init__(self, size: int = 512, cell_size: float = 0.01):
        self.size = size
        self.cell_size = cell_size
        self.dt = self.COURANT * cell_size / self.LIGHT_SPEED
        self.time: float = 0.0

        # Field arrays [size x size], three components each
        z = np.zeros((size, size), dtype=np.float32)
        self.Ex = z.copy(); self.Ey = z.copy(); self.Ez = z.copy()
        self.Hx = z.copy(); self.Hy = z.copy(); self.Hz = z.copy()

        # Material (uniform vacuum by default)
        self._permittivity  = np.ones((size, size), dtype=np.float32)
        self._permeability  = np.ones((size, size), dtype=np.float32)
        self._conductivity  = np.zeros((size, size), dtype=np.float32)

        # Pre-computed alpha/beta coefficients (recomputed if dt/cell_size changes)
        self._alpha_e: object = None
        self._beta_e:  object = None
        self._alpha_m: object = None
        self._beta_m:  object = None
        self._coeff_dirty = True

        # Sources
        self._static_charges: List[StaticCharge] = []
        self._oscillators: List[OscillatingSource] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_charges(self, charges: list[dict]) -> None:
        """
        Replace the static charge list.
        Each charge dict: {"x": float, "y": float, "z": float, "magnitude": float, "id": str}
        x/y/z are in world-space [-5,5]; we normalize to [0,1] using the same
        DEFAULT_BOUNDS as SimulationProvider.ts.
        """
        self._static_charges = []
        for c in charges:
            # Mirror toNormalizedCoordinates() from SimulationProvider.ts
            # DEFAULT_BOUNDS: min=(-5,-5,-5), max=(5,5,5) → size=10
            nx = max(0.0, min(1.0, (c["x"] - (-5.0)) / 10.0))
            ny = max(0.0, min(1.0, (c["y"] - (-5.0)) / 10.0))

            # Mirror scaleChargeMagnitude: magnitude*1e6 clamped to [-10,10]
            raw_mag = float(c.get("magnitude", 0.0))
            scaled = max(-10.0, min(10.0, raw_mag * 1e6))

            px = int(nx * self.size)
            py = int(ny * self.size)
            px = max(0, min(self.size - 1, px))
            py = max(0, min(self.size - 1, py))

            # Source ellipse: radius = 0.05 in normalized space (mirrors addPointCharge)
            radius_px = max(1, int(0.05 * self.size))
            mask = self._make_ellipse_mask(nx, ny, 0.05, 0.05)

            sc = StaticCharge(nx=nx, ny=ny, magnitude=scaled, px=px, py=py, mask=mask)
            self._static_charges.append(sc)

        # Clear Ez so the new static sources take effect immediately
        self.Ez[:] = 0

    def set_oscillators(self, oscillators: list[dict]) -> None:
        self._oscillators = [
            OscillatingSource(
                nx=float(o["nx"]),
                ny=float(o["ny"]),
                radius=float(o.get("radius", 0.05)),
                amplitude=float(o.get("amplitude", 1.0)),
                frequency=float(o.get("frequency", 1.0)),
                phase=float(o.get("phase", 0.0)),
            )
            for o in oscillators
        ]

    def step(self, n: int = 1) -> None:
        """Advance the simulation by n steps."""
        self._ensure_coefficients()
        for _ in range(n):
            self._step_electric()
            self._step_magnetic()

    def sample_at(self, positions: list[tuple]) -> list[list[float]]:
        """
        Vectorised bilinear sample of E field at N positions (nx, ny, nz) in [0,1].
        Returns [[Ex, Ey, Ez, |E|], ...].
        """
        if not positions:
            return []

        import numpy as _np  # always plain numpy for index arrays

        n = len(positions)
        nxs = _np.array([p[0] for p in positions], dtype=_np.float32)
        nys = _np.array([p[1] for p in positions], dtype=_np.float32)

        s = self.size
        px = _np.clip(nxs * s, 0.0, s - 1.0001)
        py = _np.clip(nys * s, 0.0, s - 1.0001)

        x0 = px.astype(_np.int32)
        y0 = py.astype(_np.int32)
        x1 = _np.minimum(x0 + 1, s - 1)
        y1 = _np.minimum(y0 + 1, s - 1)
        tx = (px - x0).astype(_np.float32)
        ty = (py - y0).astype(_np.float32)
        wx0y0 = (1 - tx) * (1 - ty)
        wx1y0 = tx * (1 - ty)
        wx0y1 = (1 - tx) * ty
        wx1y1 = tx * ty

        def _bilerp(field):
            # field is a (size, size) array (numpy or cupy)
            v = (field[x0, y0] * wx0y0 +
                 field[x1, y0] * wx1y0 +
                 field[x0, y1] * wx0y1 +
                 field[x1, y1] * wx1y1)
            # bring back to CPU if cupy
            return v.get() if hasattr(v, 'get') else _np.asarray(v)

        ex = _bilerp(self.Ex)
        ey = _bilerp(self.Ey)
        ez = _bilerp(self.Ez)
        mag = _np.sqrt(ex*ex + ey*ey + ez*ez)

        return [[float(ex[i]), float(ey[i]), float(ez[i]), float(mag[i])] for i in range(n)]

    def get_stats(self) -> dict:
        return {
            "size": self.size,
            "time": float(self.time),
            "dt": float(self.dt),
            "usingGpu": _USING_GPU,
            "numCharges": len(self._static_charges),
        }

    # ------------------------------------------------------------------
    # Internal: FDTD stepping
    # ------------------------------------------------------------------

    def _ensure_coefficients(self):
        if not self._coeff_dirty:
            return
        dt = np.float32(self.dt)
        cs = np.float32(self.cell_size)
        c0 = np.float32(self.LIGHT_SPEED)
        eps = self._permittivity
        mu  = self._permeability
        sig = self._conductivity

        # Electric coefficients (matches updateAlphaBeta.wgsl lines 31-35)
        c_e = sig * dt / (2.0 * eps)
        d_e = 1.0 / (1.0 + c_e)
        self._alpha_e = ((1.0 - c_e) * d_e).astype(np.float32)
        self._beta_e  = (c0 * dt / (eps * cs) * d_e).astype(np.float32)

        # Magnetic coefficients (matches updateAlphaBeta.wgsl lines 37-41)
        c_m = sig * dt / (2.0 * mu)
        d_m = 1.0 / (1.0 + c_m)
        self._alpha_m = ((1.0 - c_m) * d_m).astype(np.float32)
        self._beta_m  = (c0 * dt / (mu * cs) * d_m).astype(np.float32)

        self._coeff_dirty = False

    def _step_electric(self):
        ae, be = self._alpha_e, self._beta_e

        # Inject static sources into Ez BEFORE FDTD update (same as injectSource.wgsl)
        self._inject_sources()

        # E update — backward differences, periodic BC via np.roll
        # Ex += beta * (Hz[i,j] - Hz[i,j-1])
        self.Ex = ae * self.Ex + be * (self.Hz - np.roll(self.Hz, 1, axis=1))
        # Ey += beta * (Hz[i-1,j] - Hz[i,j])
        self.Ey = ae * self.Ey + be * (np.roll(self.Hz, 1, axis=0) - self.Hz)
        # Ez += beta * ((Hy[i,j] - Hy[i-1,j]) - (Hx[i,j] - Hx[i,j-1]))
        self.Ez = ae * self.Ez + be * (
            (self.Hy - np.roll(self.Hy, 1, axis=0)) -
            (self.Hx - np.roll(self.Hx, 1, axis=1))
        )

        # Clamp (matches field clamping in updateElectric.wgsl)
        self.Ex = np.clip(self.Ex, -self.MAX_FIELD, self.MAX_FIELD)
        self.Ey = np.clip(self.Ey, -self.MAX_FIELD, self.MAX_FIELD)
        self.Ez = np.clip(self.Ez, -self.MAX_FIELD, self.MAX_FIELD)

        # Re-apply static constraint after FDTD update (same as injectSource.wgsl constrainedEz)
        self._apply_static_constraints()

        self.time += self.dt / 2

    def _step_magnetic(self):
        am, bm = self._alpha_m, self._beta_m

        # H update — forward differences, periodic BC via np.roll
        # Hx -= beta * (Ez[i,j+1] - Ez[i,j])
        self.Hx = am * self.Hx - bm * (np.roll(self.Ez, -1, axis=1) - self.Ez)
        # Hy += beta * (Ez[i+1,j] - Ez[i,j])
        self.Hy = am * self.Hy + bm * (np.roll(self.Ez, -1, axis=0) - self.Ez)
        # Hz -= beta * ((Ey[i+1,j] - Ey[i,j]) - (Ex[i,j+1] - Ex[i,j]))
        self.Hz = am * self.Hz - bm * (
            (np.roll(self.Ey, -1, axis=0) - self.Ey) -
            (np.roll(self.Ex, -1, axis=1) - self.Ex)
        )

        # Clamp
        self.Hx = np.clip(self.Hx, -self.MAX_FIELD, self.MAX_FIELD)
        self.Hy = np.clip(self.Hy, -self.MAX_FIELD, self.MAX_FIELD)
        self.Hz = np.clip(self.Hz, -self.MAX_FIELD, self.MAX_FIELD)

        self.time += self.dt / 2

    def _inject_sources(self):
        """Oscillating sources: add amplitude*sin(2π*f*t + phase) to Ez within radius."""
        TWO_PI = 2.0 * math.pi
        for osc in self._oscillators:
            phase = TWO_PI * osc.frequency * self.time + osc.phase
            value = osc.amplitude * math.sin(phase)
            mask = self._make_ellipse_mask(osc.nx, osc.ny, osc.radius, osc.radius)
            self.Ez[mask] += np.float32(value)

    def _apply_static_constraints(self):
        """Force Ez to charge value at source pixels (Dirichlet BC for static charges)."""
        for sc in self._static_charges:
            if sc.mask is not None:
                self.Ez[sc.mask] = np.float32(sc.magnitude)

    def _make_ellipse_mask(self, nx: float, ny: float, rx: float, ry: float):
        """
        Return a boolean index mask for pixels inside the ellipse.
        nx,ny in [0,1]; rx,ry are radii in [0,1] space.
        Matches drawEllipse.wgsl logic.
        """
        size = self.size
        rx_px = max(1.0, rx * size)
        ry_px = max(1.0, ry * size)
        cx = nx * size
        cy = ny * size

        # Build index grid using numpy (works for both numpy and cupy)
        xs = np.arange(size, dtype=np.float32)
        ys = np.arange(size, dtype=np.float32)
        xx, yy = np.meshgrid(xs, ys, indexing='ij')  # shape (size, size)

        dx = (xx - cx) / rx_px
        dy = (yy - cy) / ry_px
        return (dx * dx + dy * dy) <= 1.0
