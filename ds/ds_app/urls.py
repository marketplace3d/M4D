"""ds_app URL configuration."""
from django.urls import path
from . import views

urlpatterns = [
    path("health/",              views.health,        name="health"),
    path("v1/algos/",            views.algos_list,    name="algos-list"),
    path("v1/algos/<str:algo_id>/", views.algo_detail, name="algo-detail"),
    path("v1/backtest/",         views.backtest,      name="backtest"),
    path("v1/optimize/",         views.optimize,      name="optimize"),
    path("v1/optimize/all/",     views.optimize_all,  name="optimize-all"),
    path("v1/signals/",          views.signals,       name="signals"),
    path("v1/chart/<str:symbol>/", views.chart_ohlcv,   name="chart-ohlcv"),
    path("v1/legend/scan/",      views.legend_scan,   name="legend-scan"),
    path("v1/legend/<str:symbol>/", views.legend_symbol, name="legend-symbol"),
    path("v1/mtf/<str:symbol>/", views.mtf_score,     name="mtf-score"),
    path("v1/jedi/",             views.jedi_score,    name="jedi-score"),
    path("v1/rank/",             views.algo_rank,     name="algo-rank"),
    path("v1/ai/advice/",        views.ai_advice,     name="ai-advice"),
    path("v1/ai/yoda/",          views.yoda_query,    name="yoda-query"),
    path("v1/ai/sitrep/",        views.sitrep,        name="sitrep"),
    path("v1/ai/vision/",        views.chart_vision,  name="chart-vision"),
    path("v1/ai/image/",         views.generate_image, name="generate-image"),
    path("v1/ai/batch/",         views.batch_create,    name="batch-create"),
    path("v1/ai/maxcogviz/",     views.maxcogviz_alpha, name="maxcogviz-alpha"),
    path("v1/ai/maxcogviz/history/", views.maxcogviz_history, name="maxcogviz-history"),
    path("v1/algo/weights/optimize/", views.algo_weights_optimize, name="algo-weights-optimize"),
    path("v1/ai/pulse/",             views.pulse_latest,          name="pulse-latest"),
    path("v1/ai/pulse/run/",         views.pulse_trigger_now,     name="pulse-run"),
    # XSocial mega scan (Grok × X)
    path("v1/ai/xsocial/",              views.xsocial_latest,   name="xsocial-latest"),
    path("v1/ai/xsocial/run/",          views.xsocial_run,      name="xsocial-run"),
    path("v1/ai/xsocial/<str:symbol>/", views.xsocial_asset,    name="xsocial-asset"),
    # Alpha engines
    path("v1/algo/holly/",              views.holly_scan,        name="holly-scan"),
    path("v1/algo/stat-arb/",           views.stat_arb_scan,     name="stat-arb-scan"),
    path("v1/algo/funding/",            views.funding_scan,      name="funding-scan"),
    # Risk Gate
    path("v1/risk/gate/",               views.risk_gate,         name="risk-gate"),
    path("v1/risk/pnl/",                views.risk_pnl,          name="risk-pnl"),
    # Trade-Ideas scanner
    path("v1/scanner/",                 views.scanner_run,       name="scanner"),
    path("v1/scanner/stocks/",          views.scanner_stocks,    name="scanner-stocks"),
    path("v1/scanner/crypto/",          views.scanner_crypto,    name="scanner-crypto"),
    # Futures/Crypto DB (Databento + Binance)
    path("v1/bars/",                    views.bars_query,        name="bars-query"),
    path("v1/bars/symbols/",            views.bars_symbols,      name="bars-symbols"),
    path("v1/bars/fetch/",              views.bars_fetch,        name="bars-fetch"),
    # Star-Ray Optimizer
    path("api/star-report/",            views.star_report,       name="star-report"),
    path("api/star-rerun/",             views.star_rerun,        name="star-rerun"),
    # PCA + Ensemble
    path("v1/ai/pca/",                  views.pca_report,        name="pca-report"),
    path("v1/ai/pca/run/",              views.pca_run,           name="pca-run"),
    path("v1/ai/ensemble/",             views.ensemble_report,   name="ensemble-report"),
    path("v1/ai/ensemble/run/",         views.ensemble_run,      name="ensemble-run"),
    # Sentiment trend pulse
    path("v1/ai/sentiment/",            views.sentiment_pulse,   name="sentiment-pulse"),
    # XAIGROK Activity Gate
    path("v1/ai/activity/",             views.activity_current,  name="activity-current"),
    path("v1/ai/activity/report/",      views.activity_report_view, name="activity-report"),
    path("v1/ai/activity/run/",         views.activity_run,      name="activity-run"),
    # Cross-Asset Spread Engine
    path("v1/cross/report/",            views.cross_asset_report, name="cross-asset-report"),
    path("v1/cross/run/",               views.cross_asset_run,    name="cross-asset-run"),
    # Walk-Forward Validation
    path("v1/walkforward/",             views.walkforward_report, name="walkforward-report"),
    path("v1/walkforward/run/",         views.walkforward_run,    name="walkforward-run"),
    # Trade Quality Gate
    path("v1/gate/report/",             views.gate_report,        name="gate-report"),
    path("v1/gate/run/",                views.gate_run,           name="gate-run"),
    # Delta Ops position manager
    path("v1/delta/report/",            views.delta_ops_report,   name="delta-ops-report"),
    path("v1/delta/run/",               views.delta_ops_run,      name="delta-ops-run"),
    # Re-entry Holdout Validation (#10)
    path("v1/holdout/",                 views.holdout_report,     name="holdout-report"),
    path("v1/holdout/run/",             views.holdout_run,        name="holdout-run"),
    # Order intent audit (I-OPT) — read-only
    path("v1/audit/order-intent/",      views.audit_order_intent, name="audit-order-intent"),
    # Alpaca Paper Trading (P0-D)
    path("v1/paper/status/",            views.paper_status,       name="paper-status"),
    path("v1/paper/run/",               views.paper_run,          name="paper-run"),
    path("v1/paper/flatten/",           views.paper_flatten,      name="paper-flatten"),
    path("v1/paper/score/",             views.paper_score,        name="paper-score"),
    # HMM Regime Posterior (P1-A)
    path("v1/hmm/report/",              views.hmm_report,         name="hmm-report"),
    path("v1/hmm/fit/",                 views.hmm_fit,            name="hmm-fit"),
    path("v1/hmm/proba/",               views.hmm_proba,          name="hmm-proba"),
    # IC Decay Monitor (P1-B)
    path("v1/ic/report/",               views.ic_report,          name="ic-report"),
    path("v1/ic/run/",                  views.ic_run,             name="ic-run"),
    # MTF Confirmation (P1-C)
    path("v1/mtf/",                     views.mtf_scan,           name="mtf-scan"),
    # Cost-Adjusted Sharpe (P1-D)
    path("v1/cost/adjust/",             views.cost_adjust,        name="cost-adjust"),
    # Funding Rate Signal (P2-A)
    path("v1/funding/signals/",         views.funding_signals,    name="funding-signals"),
    path("v1/funding/refresh/",         views.funding_refresh,    name="funding-refresh"),
    # OBI Signal (P2-B)
    path("v1/obi/",                     views.obi_scan,           name="obi-scan"),
    # Order Block + FVG (T2-A/B)
    path("v1/ob/",                      views.ob_scan,            name="ob-scan"),
    # VWAP Deviation (T3-A)
    path("v1/vwap/",                    views.vwap_scan,          name="vwap-scan"),
    # IC Half-Life Tracker (P3-B)
    path("v1/ic/halflife/",             views.ic_halflife_report,  name="ic-halflife-report"),
    path("v1/ic/halflife/run/",         views.ic_halflife_run,     name="ic-halflife-run"),
    # Capacity / Turnover Model (P3-C)
    path("v1/capacity/",                views.capacity_report,     name="capacity-report"),
    path("v1/capacity/run/",            views.capacity_run,        name="capacity-run"),
    # Signal Discovery Engine (P3-A)
    path("v1/discovery/",               views.discovery_report,    name="discovery-report"),
    path("v1/discovery/run/",           views.discovery_run,       name="discovery-run"),
    # Open Interest Signal
    path("v1/oi/",                      views.oi_report,           name="oi-report"),
    path("v1/oi/refresh/",              views.oi_refresh,          name="oi-refresh"),
    # Fear & Greed Index
    path("v1/fng/",                     views.fng_report,          name="fng-report"),
    path("v1/fng/refresh/",             views.fng_refresh,         name="fng-refresh"),
    # Liquidations Stream
    path("v1/liq/",                     views.liq_report,         name="liq-report"),
    path("v1/liq/status/",              views.liq_daemon_status,  name="liq-status"),
    # Human-in-the-loop signal approval
    path("v1/paper/pending/",           views.paper_pending,      name="paper-pending"),
    path("v1/paper/approve/",           views.paper_approve,      name="paper-approve"),
    path("v1/paper/equity/",            views.paper_equity,       name="paper-equity"),
    # ICT Session Gate + OBI snapshot
    path("v1/session/",                 views.session_status,     name="session-status"),
    # Operator control state
    path("v1/control/halt-lock/",       views.control_halt_lock,  name="control-halt-lock"),
    # DR/IDR Target Levels (T1-C)
    path("v1/dr/",                      views.dr_levels,          name="dr-levels"),
    path("v1/dr/scan/",                 views.dr_scan,            name="dr-scan"),
    # IBKR Paper Trading
    path("v1/ibkr/test/",               views.ibkr_test,          name="ibkr-test"),
    path("v1/ibkr/status/",             views.ibkr_status,        name="ibkr-status"),
    path("v1/ibkr/run/",                views.ibkr_run,           name="ibkr-run"),
    path("v1/ibkr/flatten/",            views.ibkr_flatten,       name="ibkr-flatten"),
    path("v1/ibkr/score/",              views.ibkr_score,         name="ibkr-score"),
]
