"""BOOM sweep: SPY-centric defaults, synthetic fallback, no backtesting.test GOOG bundle."""
from __future__ import annotations

from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

import ds_app.boom_backtest as bb
from ds_app import views


class BoomBacktestCoreTests(SimpleTestCase):
    def test_first_half_mask_daily_is_full_session(self):
        import pandas as pd

        idx = pd.date_range("2020-01-01", periods=40, freq="B")
        m = bb._first_half_market_mask(idx)
        self.assertTrue(bool(m.all()), "daily bars should not zero out first-half filter")

    def test_default_symbol_is_spy_not_goog(self):
        self.assertEqual(bb.BOOM_DEFAULT_BENCH_SYMBOL, "SPY")
        self.assertNotEqual(bb.BOOM_DEFAULT_BENCH_SYMBOL.upper(), "GOOG")
        self.assertEqual(bb.BOOM_DEFAULT_DAILY_PERIOD, "6mo")

    def test_synthetic_ohlcv_shape(self):
        df = bb.synthetic_ohlcv_bars(200, seed=1)
        self.assertGreaterEqual(len(df), 200)
        for col in ("Open", "High", "Low", "Close", "Volume"):
            self.assertIn(col, df.columns)
        self.assertTrue(df["High"].ge(df[["Open", "Close"]].max(axis=1)).all())
        self.assertTrue(df["Low"].le(df[["Open", "Close"]].min(axis=1)).all())

    def test_boom_expansion_param_list_sizes(self):
        daily = bb.boom_expansion_param_list(
            liquid_scan=False,
            wide_grid=False,
            signal_source="darvas",
            atr_mult=1.05,
            first_half_only=False,
            exit_mode="ema13",
            break_even_offset_pct=0.05,
        )
        self.assertEqual(len(daily), 3 * 3 * 3 * 3)
        narrow = bb.boom_expansion_param_list(
            liquid_scan=True,
            wide_grid=False,
            signal_source="darvas",
            atr_mult=1.05,
            first_half_only=False,
            exit_mode="ema13",
            break_even_offset_pct=0.05,
        )
        self.assertEqual(len(narrow), 2 * 2 * 2 * 2)
        wide = bb.boom_expansion_param_list(
            liquid_scan=True,
            wide_grid=True,
            signal_source="darvas",
            atr_mult=1.05,
            first_half_only=False,
            exit_mode="ema13",
            break_even_offset_pct=0.05,
        )
        self.assertEqual(len(wide), 4 * 4 * 4 * 3)

    def test_normalize_ohlcv_multiindex_columns(self):
        import pandas as pd

        # yfinance-style MultiIndex
        idx = pd.date_range("2024-01-01", periods=5, freq="D", tz="UTC")
        raw = pd.DataFrame(
            {
                ("Open", "SPY"): [1, 2, 3, 4, 5],
                ("High", "SPY"): [2, 3, 4, 5, 6],
                ("Low", "SPY"): [0.5, 1.5, 2.5, 3.5, 4.5],
                ("Close", "SPY"): [1.5, 2.5, 3.5, 4.5, 5.5],
                ("Volume", "SPY"): [100] * 5,
            },
            index=idx,
        )
        raw.columns = pd.MultiIndex.from_tuples(raw.columns)
        out = bb._normalize_ohlcv(raw)
        self.assertEqual(list(out.columns), ["Open", "High", "Low", "Close", "Volume"])

    def test_load_universe_synthetic_when_empty(self):
        def _fail_download(*_a, **_k):
            raise RuntimeError("no network")

        with patch("yfinance.download", side_effect=_fail_download):
            frames, src = bb._load_universe_frames(["SPY"], "1d", "6mo")
        self.assertEqual(src, "synthetic")
        self.assertIn("SPY", frames)
        self.assertGreaterEqual(len(frames["SPY"]), 120)

    @patch.object(bb, "BOOM_GRID_DAILY", ([14], [10], [1.2], [5]))
    def test_run_boom_grid_smoke_synthetic(self):
        with patch.object(bb, "_load_universe_frames", return_value=({"SPY": bb.synthetic_ohlcv_bars(250, seed=3)}, "synthetic")):
            out = bb.run_boom_expansion_grid(
                limit_top=3,
                liquid_scan=False,
                min_trades=1,
                atr_mult=1.0,
                first_half_only=False,
            )
        self.assertEqual(out["tested"], 1)
        self.assertEqual(out["symbols"], ["SPY"])
        self.assertEqual(out["data_source"], "synthetic")
        self.assertIn("synthetic", out["dataset"])
        self.assertGreater(len(out["top"]), 0)
        row0 = out["top"][0]
        self.assertEqual(row0["symbol"], "SPY")
        for key in ("return_pct", "max_dd_pct", "trades", "squeeze_len"):
            self.assertIn(key, row0)
        surf = out["analysis"].get("surface", {})
        self.assertEqual(surf.get("symbols_loaded"), 1)
        self.assertEqual(surf.get("param_sets_per_symbol"), 1)
        self.assertEqual(surf.get("runs_total"), 1)

    @patch.object(bb, "BOOM_GRID_DAILY", ([14], [10], [1.2], [5]))
    def test_boom_run_record_manifest(self):
        with patch.object(bb, "_load_universe_frames", return_value=({"SPY": bb.synthetic_ohlcv_bars(250, seed=4)}, "synthetic")):
            res = bb.run_boom_expansion_grid(limit_top=2, liquid_scan=False, min_trades=1)
        manifest = bb.boom_run_record(
            url_params={"scan": "0"},
            liquid_scan=False,
            wide_grid=False,
            result=res,
            limit_top=2,
        )
        self.assertEqual(manifest["schema_version"], 1)
        self.assertIn("SPY", manifest["result_summary"].get("symbols", []))
        self.assertNotIn("GOOG", str(manifest))
        self.assertIn("signal_energy_model", manifest)
        self.assertEqual(manifest["signal_energy_model"].get("schema_version"), 1)

    @patch.object(bb, "BOOM_GRID_DAILY", ([14], [10], [1.2], [5]))
    def test_boom_json_endpoint_no_goog(self):
        with patch.object(bb, "_load_universe_frames", return_value=({"SPY": bb.synthetic_ohlcv_bars(250, seed=5)}, "synthetic")):
            rf = RequestFactory()
            req = rf.get("/boom-backtest/", {"format": "json", "scan": "0"})
            resp = views.boom_backtest_page(req)
        self.assertEqual(resp.status_code, 200)
        raw = resp.content.decode("utf-8")
        self.assertNotIn("GOOG", raw)


class BoomVisualTests(SimpleTestCase):
    def test_boom_params_for_viz_stop_daily_vs_intraday(self):
        p_i = bb.boom_params_for_viz(
            "5m",
            14,
            10,
            1.2,
            3,
            signal_source="darvas",
            atr_mult=1.05,
            first_half_only=True,
            exit_mode="ema13",
            break_even_offset_pct=0.05,
        )
        self.assertEqual(p_i.stop_loss_pct, 0.65)
        p_d = bb.boom_params_for_viz(
            "1d",
            14,
            10,
            1.2,
            5,
            signal_source="darvas",
            atr_mult=1.0,
            first_half_only=False,
            exit_mode="ema13",
            break_even_offset_pct=0.05,
        )
        self.assertEqual(p_d.stop_loss_pct, 0.7)

    @patch.object(bb, "_load_universe_frames", return_value=({"SPY": bb.synthetic_ohlcv_bars(300, seed=11)}, "synthetic"))
    def test_run_boom_visual_bundle_has_ema13(self, _mock):
        p = bb.boom_params_for_viz(
            "1d",
            14,
            10,
            1.2,
            5,
            signal_source="darvas",
            atr_mult=1.0,
            first_half_only=False,
            exit_mode="ema13",
            break_even_offset_pct=0.05,
        )
        out = bb.run_boom_visual_bundle("SPY", "1d", "6mo", p, flat_eod=False, max_bars=400)
        self.assertIn("ema13", out["feat"].columns)
        self.assertIsNotNone(out["trades"])
        self.assertGreater(len(out["df"]), 100)

    @patch.object(bb, "_load_universe_frames", return_value=({"SPY": bb.synthetic_ohlcv_bars(300, seed=12)}, "synthetic"))
    def test_boom_visual_page_renders(self, _mock):
        rf = RequestFactory()
        req = rf.get("/boom-visual/", {"symbol": "SPY", "scan": "0", "tf": "1d", "first_half": "0", "eod": "0"})
        resp = views.boom_visual_page(req)
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "BOOM visual")


class BoomLiquidLabelTests(SimpleTestCase):
    @patch.object(bb, "BOOM_GRID_LIQUID_NARROW", ([14], [10], [1.2], [5]))
    def test_liquid_label_synthetic_suffix(self):
        with patch.object(bb, "_load_universe_frames", return_value=({"SPY": bb.synthetic_ohlcv_bars(250, seed=6)}, "synthetic")):
            out = bb.run_boom_expansion_grid(
                limit_top=1,
                liquid_scan=True,
                min_trades=1,
            )
        self.assertIn("+synthetic", out["dataset"])
        self.assertEqual(out["data_source"], "synthetic")
