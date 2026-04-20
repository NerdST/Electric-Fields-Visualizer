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

Boundary: periodic (slice-based wrap, same as wrapIndex in WGSL).
Sources:  static point charges constrain Ez at their pixel each step (Dirichlet BC).
          oscillating sources add amplitude*sin(2*pi*f*t + phase) to Ez.

Optional GPU acceleration: swap `import numpy as np` for `import cupy as np` at top.
"""

from __future__ import annotations

import math
import numpy as _np        # always plain numpy — needed for CPU-side index arrays in sample_at
from dataclasses import dataclass, field
from typing import List, Optional

try:
    import cupy as _cupy
    _cupy.zeros(1)         # force CUDA init — fails here if no GPU, not buried in a request
    import cupy as np      # type: ignore
    _USING_GPU = True
except Exception:
    import numpy as np     # type: ignore
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
    px: int = 0
    py: int = 0
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
    mask: Optional[object] = field(default=None, repr=False)  # pre-computed, cached


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

        # Field arrays [size x size]
        z = np.zeros((size, size), dtype=np.float32)
        self.Ex = z.copy(); self.Ey = z.copy(); self.Ez = z.copy()
        self.Hx = z.copy(); self.Hy = z.copy(); self.Hz = z.copy()

        # Material (uniform vacuum by default)
        self._permittivity = np.ones((size, size), dtype=np.float32)
        self._permeability = np.ones((size, size), dtype=np.float32)
        self._conductivity = np.zeros((size, size), dtype=np.float32)

        # Scalar or array coefficients (recomputed when _coeff_dirty)
        self._alpha_e: object = None
        self._beta_e:  object = None
        self._alpha_m: object = None
        self._beta_m:  object = None
        self._coeff_dirty = True

        # Pre-allocated scratch buffers — eliminates per-step heap allocations.
        # buf1 / buf2 hold intermediate finite-difference results during _step_* methods.
        self._buf1 = z.copy()
        self._buf2 = z.copy()

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
            # Mirror toNormalizedCoordinates(): DEFAULT_BOUNDS min=(-5,-5,-5) max=(5,5,5)
            nx = max(0.0, min(1.0, (c["x"] - (-5.0)) / 10.0))
            ny = max(0.0, min(1.0, (c["y"] - (-5.0)) / 10.0))

            # Mirror scaleChargeMagnitude: magnitude*1e6 clamped to [-10,10]
            scaled = max(-10.0, min(10.0, float(c.get("magnitude", 0.0)) * 1e6))

            px = max(0, min(self.size - 1, int(nx * self.size)))
            py = max(0, min(self.size - 1, int(ny * self.size)))

            # Source ellipse radius = 0.05 in normalized space (mirrors addPointCharge)
            mask = self._make_ellipse_mask(nx, ny, 0.05, 0.05)
            self._static_charges.append(StaticCharge(nx=nx, ny=ny, magnitude=scaled,
                                                      px=px, py=py, mask=mask))

        # Clear Ez so new sources take effect immediately
        self.Ez[:] = 0

    def set_oscillators(self, oscillators: list[dict]) -> None:
        """Set oscillating sources, pre-computing each source's spatial mask once."""
        self._oscillators = []
        for o in oscillators:
            osc = OscillatingSource(
                nx=float(o["nx"]),
                ny=float(o["ny"]),
                radius=float(o.get("radius", 0.05)),
                amplitude=float(o.get("amplitude", 1.0)),
                frequency=float(o.get("frequency", 1.0)),
                phase=float(o.get("phase", 0.0)),
            )
            # Pre-compute mask once — reused every step instead of reallocated
            osc.mask = self._make_ellipse_mask(osc.nx, osc.ny, osc.radius, osc.radius)
            self._oscillators.append(osc)

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

        def _bilerp(f):
            v = (f[x0, y0] * wx0y0 + f[x1, y0] * wx1y0 +
                 f[x0, y1] * wx0y1 + f[x1, y1] * wx1y1)
            # Transfer GPU→CPU if running with CuPy
            return v.get() if hasattr(v, 'get') else _np.asarray(v)

        ex  = _bilerp(self.Ex)
        ey  = _bilerp(self.Ey)
        ez  = _bilerp(self.Ez)
        mag = _np.sqrt(ex*ex + ey*ey + ez*ez)

        # Build output as a (n,4) array then convert — faster than a Python for-loop
        return _np.column_stack([ex, ey, ez, mag]).tolist()

    def get_stats(self) -> dict:
        return {
            "size": self.size,
            "time": float(self.time),
            "dt": float(self.dt),
            "usingGpu": _USING_GPU,
            "numCharges": len(self._static_charges),
        }

    # ------------------------------------------------------------------
    # Internal: coefficients
    # ------------------------------------------------------------------

    def _ensure_coefficients(self):
        if not self._coeff_dirty:
            return
        dt = self.dt
        cs = self.cell_size
        c0 = self.LIGHT_SPEED
        eps = self._permittivity
        mu  = self._permeability
        sig = self._conductivity

        # Optimisation: for uniform vacuum (the common case) use scalars instead of
        # full-grid arrays.  NumPy/CuPy broadcast scalars against 2-D arrays for free.
        if (float(sig.max()) == 0.0 and float(eps.min()) == 1.0 and float(eps.max()) == 1.0
                and float(mu.min()) == 1.0 and float(mu.max()) == 1.0):
            self._alpha_e = _np.float32(1.0)
            self._beta_e  = _np.float32(c0 * dt / cs)
            self._alpha_m = _np.float32(1.0)
            self._beta_m  = _np.float32(c0 * dt / cs)
        else:
            # Per-cell heterogeneous material coefficients
            # Electric (matches updateAlphaBeta.wgsl lines 31-35)
            c_e = sig * dt / (2.0 * eps)
            d_e = 1.0 / (1.0 + c_e)
            self._alpha_e = ((1.0 - c_e) * d_e).astype(np.float32)
            self._beta_e  = (c0 * dt / (eps * cs) * d_e).astype(np.float32)

            # Magnetic (matches updateAlphaBeta.wgsl lines 37-41)
            c_m = sig * dt / (2.0 * mu)
            d_m = 1.0 / (1.0 + c_m)
            self._alpha_m = ((1.0 - c_m) * d_m).astype(np.float32)
            self._beta_m  = (c0 * dt / (mu * cs) * d_m).astype(np.float32)

        self._coeff_dirty = False

    # ------------------------------------------------------------------
    # Internal: FDTD stepping (in-place, zero heap allocations per step)
    # ------------------------------------------------------------------

    def _step_electric(self):
        ae, be = self._alpha_e, self._beta_e
        buf1, buf2 = self._buf1, self._buf2

        self._inject_sources()

        # Ex[i,j] = ae*Ex[i,j] + be*(Hz[i,j] - Hz[i,j-1])
        # Hz[i,j-1] = roll(Hz, +1, axis=1) written into buf1
        buf1[:, 1:] = self.Hz[:, :-1]
        buf1[:, 0]  = self.Hz[:, -1]
        np.subtract(self.Hz, buf1, out=buf1)   # buf1 = Hz - Hz[j-1]
        np.multiply(ae, self.Ex, out=self.Ex)
        np.add(self.Ex, be * buf1, out=self.Ex)

        # Ey[i,j] = ae*Ey[i,j] + be*(Hz[i-1,j] - Hz[i,j])
        # Hz[i-1,j] = roll(Hz, +1, axis=0) into buf1
        buf1[1:, :] = self.Hz[:-1, :]
        buf1[0, :]  = self.Hz[-1, :]
        np.subtract(buf1, self.Hz, out=buf1)   # buf1 = Hz[i-1] - Hz
        np.multiply(ae, self.Ey, out=self.Ey)
        np.add(self.Ey, be * buf1, out=self.Ey)

        # Ez[i,j] = ae*Ez[i,j] + be*((Hy[i,j]-Hy[i-1,j]) - (Hx[i,j]-Hx[i,j-1]))
        # Hy[i-1,j] = roll(Hy, +1, axis=0) into buf1
        buf1[1:, :] = self.Hy[:-1, :]
        buf1[0, :]  = self.Hy[-1, :]
        np.subtract(self.Hy, buf1, out=buf1)   # buf1 = Hy - Hy[i-1]
        # Hx[i,j-1] = roll(Hx, +1, axis=1) into buf2
        buf2[:, 1:] = self.Hx[:, :-1]
        buf2[:, 0]  = self.Hx[:, -1]
        np.subtract(self.Hx, buf2, out=buf2)   # buf2 = Hx - Hx[j-1]
        np.subtract(buf1, buf2, out=buf1)       # buf1 = curl term
        np.multiply(ae, self.Ez, out=self.Ez)
        np.add(self.Ez, be * buf1, out=self.Ez)

        # Clamp in-place
        np.clip(self.Ex, -self.MAX_FIELD, self.MAX_FIELD, out=self.Ex)
        np.clip(self.Ey, -self.MAX_FIELD, self.MAX_FIELD, out=self.Ey)
        np.clip(self.Ez, -self.MAX_FIELD, self.MAX_FIELD, out=self.Ez)

        # Re-apply static Dirichlet constraint after FDTD update
        self._apply_static_constraints()

        self.time += self.dt / 2

    def _step_magnetic(self):
        am, bm = self._alpha_m, self._beta_m
        buf1, buf2 = self._buf1, self._buf2

        # Hx[i,j] = am*Hx[i,j] - bm*(Ez[i,j+1] - Ez[i,j])
        # Ez[i,j+1] = roll(Ez, -1, axis=1) into buf1
        buf1[:, :-1] = self.Ez[:, 1:]
        buf1[:, -1]  = self.Ez[:, 0]
        np.subtract(buf1, self.Ez, out=buf1)   # buf1 = Ez[j+1] - Ez
        np.multiply(am, self.Hx, out=self.Hx)
        np.subtract(self.Hx, bm * buf1, out=self.Hx)

        # Hy[i,j] = am*Hy[i,j] + bm*(Ez[i+1,j] - Ez[i,j])
        # Ez[i+1,j] = roll(Ez, -1, axis=0) into buf1
        buf1[:-1, :] = self.Ez[1:, :]
        buf1[-1, :]  = self.Ez[0, :]
        np.subtract(buf1, self.Ez, out=buf1)   # buf1 = Ez[i+1] - Ez
        np.multiply(am, self.Hy, out=self.Hy)
        np.add(self.Hy, bm * buf1, out=self.Hy)

        # Hz[i,j] = am*Hz[i,j] - bm*((Ey[i+1,j]-Ey[i,j]) - (Ex[i,j+1]-Ex[i,j]))
        # Ey[i+1,j] = roll(Ey, -1, axis=0) into buf1
        buf1[:-1, :] = self.Ey[1:, :]
        buf1[-1, :]  = self.Ey[0, :]
        np.subtract(buf1, self.Ey, out=buf1)   # buf1 = Ey[i+1] - Ey
        # Ex[i,j+1] = roll(Ex, -1, axis=1) into buf2
        buf2[:, :-1] = self.Ex[:, 1:]
        buf2[:, -1]  = self.Ex[:, 0]
        np.subtract(buf2, self.Ex, out=buf2)   # buf2 = Ex[j+1] - Ex
        np.subtract(buf1, buf2, out=buf1)       # buf1 = curl term
        np.multiply(am, self.Hz, out=self.Hz)
        np.subtract(self.Hz, bm * buf1, out=self.Hz)

        # Clamp in-place
        np.clip(self.Hx, -self.MAX_FIELD, self.MAX_FIELD, out=self.Hx)
        np.clip(self.Hy, -self.MAX_FIELD, self.MAX_FIELD, out=self.Hy)
        np.clip(self.Hz, -self.MAX_FIELD, self.MAX_FIELD, out=self.Hz)

        self.time += self.dt / 2

    def _inject_sources(self):
        """Oscillating sources: add amplitude*sin(2π*f*t + phase) to Ez.
        Masks are pre-computed in set_oscillators — no allocation here."""
        TWO_PI = 2.0 * math.pi
        for osc in self._oscillators:
            value = np.float32(osc.amplitude * math.sin(TWO_PI * osc.frequency * self.time + osc.phase))
            self.Ez[osc.mask] += value

    def _apply_static_constraints(self):
        """Force Ez to charge magnitude at source pixels (Dirichlet BC)."""
        for sc in self._static_charges:
            if sc.mask is not None:
                self.Ez[sc.mask] = np.float32(sc.magnitude)

    def _make_ellipse_mask(self, nx: float, ny: float, rx: float, ry: float):
        """
        Boolean index mask for pixels inside the ellipse (nx,ny centre, rx,ry radii in [0,1]).
        Matches drawEllipse.wgsl logic.
        """
        size = self.size
        rx_px = max(1.0, rx * size)
        ry_px = max(1.0, ry * size)
        cx = nx * size
        cy = ny * size

        xs = np.arange(size, dtype=np.float32)
        ys = np.arange(size, dtype=np.float32)
        xx, yy = np.meshgrid(xs, ys, indexing='ij')

        dx = (xx - cx) / rx_px
        dy = (yy - cy) / ry_px
        return (dx * dx + dy * dy) <= 1.0
