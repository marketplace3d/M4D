"""vectorbt mass BOOM grid — optimised test suite."""
from __future__ import annotations

import json
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

import ds_app.boom_backtest as bb
import ds_app.boom_vectorbt as bvb
from ds_app import views

# ---------------------------------------------------------------------------
# Shared synthetic frames — built ONCE at import time, reused across all
# tests. `synthetic_ohlcv_bars` clamps n to >= 150; use 200 so intent is
# obvious and we stay above Darvas min bars (>= 120) with headroom.
# ---------------------------------------------------------------------------
_FRAMES_1 = {"SPY": bb.synthetic_ohlcv_bars(200, seed=42)}
_FRAMES_2 = {"SPY": bb.synthetic_ohlcv_bars(200, seed=43)}
_FRAMES_3 = {"SPY": bb.synthetic_ohlcv_bars(200, seed=44)}
_FRAMES_4 = {"SPY": bb.synthetic_ohlcv_bars(200, seed=45)}
_FRAMES_MULTI = {
    "NVDA": bb.synthetic_ohlcv_bars(200, seed=71),
    "TSLA": bb.synthetic_ohlcv_bars(200, seed=72),
}

# Patch by module path so the stub always hits the name `run_*` resolves at runtime
# (avoids edge cases where `patch.object(bvb, ...)` misses duplicate imports).
_VBT_LOAD_PATCH = "ds_app.boom_vectorbt._load_universe_frames"


def _mock(frames: dict, source: str = "synthetic"):
    """Return a patch for _load_universe_frames with a pre-built return value."""
    return patch(_VBT_LOAD_PATCH, return_value=(frames, source))


class VectorbtBoomGridTests(SimpleTestCase):
    """All tests share module-level frames — no per-test OHLCV construction."""

    def test_expansion_rank_sort_prefers_trades_over_zero_trade_score(self):
        """Zero-trade rows must not outrank losers when min_trades=0 includes both."""
        dead = {"return_pct": 0.0, "max_dd_pct": 0.0, "win_rate_pct": 0.0, "trades": 0}
        live = {"return_pct": -10.0, "max_dd_pct": 5.0, "win_rate_pct": 0.0, "trades": 1}
        self.assertLess(
            bvb._expansion_rank_sort_key("boom", live),
            bvb._expansion_rank_sort_key("boom", dead),
        )
        self.assertLess(
            bvb._expansion_rank_sort_key("calmar", live),
            bvb._expansion_rank_sort_key("calmar", dead),
        )

    # --- darvas grid ---------------------------------------------------------

    def test_run_boom_darvas_vectorbt_grid_shapes(self):
        with _mock(_FRAMES_1):
            out = bvb.run_boom_darvas_vectorbt_grid(
                "SPY", "1d", "6mo",
                squeeze_lens=(14, 20),
                darvas_lookbacks=(10, 15),
                rvol_thresholds=(1.2, 1.35),
                max_combos=500,
                first_half_only=False,
            )
        self.assertEqual(out["symbol"], "SPY")
        self.assertEqual(out["data_source"], "synthetic")
        self.assertEqual(out["grid_size"], 8)  # 2×2×2, exact
        self.assertGreaterEqual(len(out["top_sharpe"]), 1)
        self.assertIn("squeeze_len", out["top_sharpe"][0])
        # Profit-aware ordering (same composite as boom-backtest); not a profitability guarantee.
        self.assertGreaterEqual(len(out["top_boom"]), 1)
        self.assertIn("boom_rank_score", out["top_boom"][0])
        self.assertIn("calmar_proxy", out["top_boom"][0])

    def test_vectorbt_boom_page_json(self):
        rf = RequestFactory()
        req = rf.get("/vectorbt-boom/", {
            "format": "json", "symbol": "SPY", "tf": "1d",
            "max_combos": "8",  # was 80 — 8 combos is enough
            "sq_min": "14", "sq_max": "16", "sq_step": "2",
            "dv_min": "10", "dv_max": "12", "dv_step": "2",
            "rvol_n": "2",  # was 3 — 2 steps sufficient
            "first_half": "0",
        })
        with _mock(_FRAMES_2):
            resp = views.vectorbt_boom_page(req)
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"top_sharpe", resp.content)

    # --- expansion grid ------------------------------------------------------

    def test_run_boom_expansion_vectorbt_grid(self):
        with _mock(_FRAMES_3):
            out = bvb.run_boom_expansion_vectorbt_grid(
                timeframe="1d", period="6mo",
                liquid_scan=False, bench_symbol="SPY",
                max_combos=12, limit_top=4,
                signal_source="darvas", exit_mode="ema13",
                atr_mult=1.0, first_half_only=False, min_trades=1,
            )
        self.assertEqual(out["engine"], "vectorbt")
        self.assertEqual(out["tested"], 12)
        self.assertEqual(out["param_sets"], 12)
        self.assertGreaterEqual(int(out.get("unique_signal_columns", 0)), 1)
        self.assertGreaterEqual(len(out["top"]), 1)
        self.assertIn("hold_bars", out["top"][0])

    def test_run_boom_expansion_rank_mode_calmar(self):
        with _mock(_FRAMES_3):
            out = bvb.run_boom_expansion_vectorbt_grid(
                timeframe="1d", period="6mo",
                liquid_scan=False, bench_symbol="SPY",
                max_combos=12, limit_top=4,
                signal_source="darvas", exit_mode="ema13",
                atr_mult=1.0, first_half_only=False, min_trades=1,
                rank_mode="calmar",
            )
        self.assertEqual(out["rank_mode"], "calmar")
        self.assertGreaterEqual(len(out["top"]), 1)

    def test_vectorbt_expansion_page_json(self):
        rf = RequestFactory()
        req = rf.get("/vectorbt-expansion/", {
            "format": "json", "tf": "1d",
            "max_combos": "15", "first_half": "0",
        })
        with _mock(_FRAMES_4):
            resp = views.vectorbt_expansion_page(req)
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["engine"], "vectorbt")  # exact, not assertIn

    # --- multi-symbol liquid scan --------------------------------------------

    def test_vectorbt_expansion_json_liquid_nvda_tsla_arrows_ema13(self):
        """GET /vectorbt-expansion/?scan=1&symbols=NVDA,TSLA&signal=arrows — narrow grid."""
        rf = RequestFactory()
        req = rf.get("/vectorbt-expansion/", {
            "format": "json", "scan": "1",
            "symbols": "NVDA,TSLA", "signal": "arrows", "exit": "ema13",
            "tf": "1d", "period": "6mo", "first_half": "0",
            "min_trades": "0", "max_combos": "500",
            "limit_top": "12",
        })
        with _mock(_FRAMES_MULTI):
            resp = views.vectorbt_expansion_page(req)
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)

        self.assertEqual(data["engine"], "vectorbt")
        plist = bb.boom_expansion_param_list(
            liquid_scan=True,
            wide_grid=False,
            signal_source="arrows",
            atr_mult=1.05,
            first_half_only=False,
            exit_mode="ema13",
            break_even_offset_pct=0.05,
        )
        self.assertEqual(data["param_sets"], len(plist))
        self.assertEqual(data["tested"], len(plist) * 2)
        exp_unique = len(
            {bvb._expansion_vbt_column_identity(p, "ema13") for p in plist}
        )
        # arrows+ema13: SQ/DV/RVOL/hold inert on entry → expect a single vbt column identity.
        self.assertEqual(exp_unique, 1)
        self.assertEqual(data["unique_signal_columns"], exp_unique)
        self.assertIn("NVDA", data["symbols"])
        self.assertIn("TSLA", data["symbols"])
        self.assertGreaterEqual(len(data["top"]), 1)
        top_syms = {r["symbol"] for r in data["top"]}
        self.assertTrue(top_syms <= {"NVDA", "TSLA"})
