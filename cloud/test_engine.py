"""
Tests for FDTDEngine correctness.

Run from the repo root:
    python cloud/test_engine.py

What each test verifies:
  1. Dirichlet BC      — Ez at a static charge pixel is held to the correct magnitude.
  2. Field propagation — An oscillating source drives a wave; the field reaches a
                         point at distance r after ≥ r/cell steps (Courant = 0.5, so
                         the numerical wave speed is c * COURANT ≈ 0.5 cell/step).
  3. Charge update     — Changing a charge's magnitude immediately changes Ez at the
                         source pixel on the very next step.
  4. Charge removal    — Removing all charges lets the field decay freely (no longer
                         pinned); Ez at the old source pixel must change.
  5. Blank propagation — With no sources and zero initial field, Ez stays zero forever.
  6. sample_at shape   — sample_at returns exactly [Ex, Ey, Ez, |E|] for each query.
"""

import sys
import os
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'cloud'))
from fdtd_engine import FDTDEngine


PASS = "✓"
FAIL = "✗"
_results: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = ""):
    status = PASS if condition else FAIL
    _results.append((name, condition, detail))
    print(f"  {status}  {name}" + (f"  — {detail}" if detail else ""))
    return condition


# ---------------------------------------------------------------------------
# 1. Dirichlet BC: static charge pins Ez at its pixel
# ---------------------------------------------------------------------------
def test_dirichlet_bc():
    print("\n[1] Dirichlet BC — static charge pins Ez at source pixel")

    engine = FDTDEngine(size=64, cell_size=0.01)
    # World (0,0,0) → normalised (0.5,0.5) → pixel (32,32)
    engine.set_charges([{'x': 0, 'y': 0, 'z': 0, 'magnitude': 1e-6, 'id': 'c1'}])
    engine.step(20)

    # scaleChargeMagnitude: 1e-6 * 1e6 = 1.0, clamped to [-10,10] → 1.0
    result = engine.sample_at([(0.5, 0.5, 0.0)])
    ez = result[0][2]
    check("Ez at source == 1.0 after 20 steps", abs(ez - 1.0) < 0.05,
          f"Ez = {ez:.4f}")


# ---------------------------------------------------------------------------
# 2. Field propagation: static charge drives a wave outward
# ---------------------------------------------------------------------------
def test_propagation():
    """
    The FDTD wave front travels at exactly COURANT = 0.5 cells/step.

    Frequency note: if you use an oscillating source instead, the frequency must be
    physically meaningful relative to dt.  For a 128-cell grid with cell_size=0.01 m:
        dt = 0.5 * 0.01 / 3e8  ≈  1.67e-11 s
    A source at f=1 Hz barely moves over thousands of steps (period = 1s, each step is
    16 ps).  Use f ~ 1/(N_cycles * dt) — e.g. to complete 2 cycles in 40 steps:
        f = 2 / (40 * 1.67e-11)  ≈  3 GHz
    Static charges are simpler: the Dirichlet constraint drives a continuous wavefront
    without needing a tuned frequency.
    """
    print("\n[2] Field propagation — wave travels ~0.5 cells/step (Courant = 0.5)")

    size = 128
    engine = FDTDEngine(size=size, cell_size=0.01)

    # Static charge at centre: pins Ez = 1.0 and continuously drives the wave outward.
    engine.set_charges([{'x': 0, 'y': 0, 'z': 0, 'magnitude': 1e-6, 'id': 'c1'}])

    # Probe point: 30 cells from centre in the +x direction
    probe_dist_cells = 30
    probe_nx = 0.5 + probe_dist_cells / size

    # After only 5 steps the wave has reached at most ~2.5 cells — probe should be near zero.
    engine.step(5)
    early_mag = engine.sample_at([(probe_nx, 0.5, 0.0)])[0][3]

    # After 80 steps total the front has traveled ~40 cells; probe at 30 cells is well inside.
    engine.step(75)
    later_mag = engine.sample_at([(probe_nx, 0.5, 0.0)])[0][3]

    check("Field near zero before wave arrives (5 steps)", early_mag < 0.05,
          f"|E| = {early_mag:.6f}")
    check("Field non-zero after wave arrives (80 steps)", later_mag > 0.001,
          f"|E| = {later_mag:.6f}")
    check("Field grew over time at probe", later_mag > early_mag,
          f"{early_mag:.6f} → {later_mag:.6f}")


# ---------------------------------------------------------------------------
# 3. Charge magnitude update propagates immediately to source pixel
# ---------------------------------------------------------------------------
def test_charge_update():
    print("\n[3] Charge update — changing magnitude updates Ez on next step")

    engine = FDTDEngine(size=64, cell_size=0.01)
    engine.set_charges([{'x': 0, 'y': 0, 'z': 0, 'magnitude': 1e-6, 'id': 'c1'}])
    engine.step(10)

    before = engine.sample_at([(0.5, 0.5, 0.0)])[0][2]  # Ez at source

    # Double the magnitude: 2e-6 * 1e6 = 2.0
    engine.set_charges([{'x': 0, 'y': 0, 'z': 0, 'magnitude': 2e-6, 'id': 'c1'}])
    engine.step(1)

    after = engine.sample_at([(0.5, 0.5, 0.0)])[0][2]
    check("Ez at source == 2.0 after magnitude doubling", abs(after - 2.0) < 0.05,
          f"before={before:.3f}, after={after:.3f}")
    check("Ez changed by ~1.0 (from 1→2)", abs(after - before - 1.0) < 0.1,
          f"Δ={after - before:.3f}")


# ---------------------------------------------------------------------------
# 4. Charge removal — source pixel is no longer pinned, field can decay
# ---------------------------------------------------------------------------
def test_charge_removal():
    print("\n[4] Charge removal — removing charge unpins Ez at old source pixel")

    engine = FDTDEngine(size=64, cell_size=0.01)
    engine.set_charges([{'x': 0, 'y': 0, 'z': 0, 'magnitude': 1e-6, 'id': 'c1'}])
    engine.step(20)

    pinned = engine.sample_at([(0.5, 0.5, 0.0)])[0][2]

    engine.set_charges([])   # remove all charges
    engine.step(10)

    freed = engine.sample_at([(0.5, 0.5, 0.0)])[0][2]
    check("Ez was pinned before removal", abs(pinned - 1.0) < 0.1,
          f"Ez = {pinned:.4f}")
    check("Ez changed after charge removed (no longer Dirichlet-pinned)",
          abs(freed - pinned) > 0.01,
          f"pinned={pinned:.4f}, freed={freed:.4f}")


# ---------------------------------------------------------------------------
# 5. Blank propagation — zero field stays zero with no sources
# ---------------------------------------------------------------------------
def test_blank():
    print("\n[5] Blank propagation — no sources, zero field stays zero")

    engine = FDTDEngine(size=64, cell_size=0.01)
    engine.step(50)

    corners = [(0.1, 0.1, 0.0), (0.9, 0.1, 0.0), (0.5, 0.9, 0.0)]
    results = engine.sample_at(corners)
    max_mag = max(r[3] for r in results)
    check("All fields remain zero", max_mag < 1e-10, f"max |E| = {max_mag:.2e}")


# ---------------------------------------------------------------------------
# 6. sample_at output shape and types
# ---------------------------------------------------------------------------
def test_sample_shape():
    print("\n[6] sample_at — output shape and content")

    engine = FDTDEngine(size=32, cell_size=0.01)
    engine.set_charges([{'x': 0, 'y': 0, 'z': 0, 'magnitude': 1e-6, 'id': 'c1'}])
    engine.step(5)

    positions = [(0.1, 0.2, 0.0), (0.5, 0.5, 0.0), (0.8, 0.3, 0.0)]
    results = engine.sample_at(positions)

    check("Returns N rows", len(results) == 3, f"got {len(results)}")
    check("Each row has 4 values", all(len(r) == 4 for r in results))

    ex, ey, ez, mag = results[1]
    check("|E| == sqrt(Ex²+Ey²+Ez²)",
          abs(mag - math.sqrt(ex**2 + ey**2 + ez**2)) < 1e-5,
          f"|E|={mag:.4f}, computed={math.sqrt(ex**2+ey**2+ez**2):.4f}")

    check("sample_at([]) returns []", engine.sample_at([]) == [])


# ---------------------------------------------------------------------------
# Run all
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    print("=" * 60)
    print("FDTD Engine Tests")
    print("=" * 60)

    test_dirichlet_bc()
    test_propagation()
    test_charge_update()
    test_charge_removal()
    test_blank()
    test_sample_shape()

    passed = sum(1 for _, ok, _ in _results if ok)
    total  = len(_results)
    print("\n" + "=" * 60)
    print(f"Results: {passed}/{total} passed")
    if passed < total:
        print("\nFailed checks:")
        for name, ok, detail in _results:
            if not ok:
                print(f"  {FAIL}  {name}  — {detail}")
    print("=" * 60)
    sys.exit(0 if passed == total else 1)
