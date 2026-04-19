from django.urls import path, re_path

from ds_app import views

urlpatterns = [
    path("", views.home, name="home"),
    path("ping/", views.ping, name="ping"),
    path("backtesting/", views.backtesting_page, name="backtesting_page"),
    path("vectorbt/", views.vectorbt_page, name="vectorbt_page"),
    path("vectorbt-boom/", views.vectorbt_boom_page, name="vectorbt_boom_page"),
    path("vectorbt-expansion/", views.vectorbt_expansion_page, name="vectorbt_expansion_page"),
    path("backtrader/", views.backtrader_page, name="backtrader_page"),
    path("nautilus/", views.nautilus_page, name="nautilus_page"),
    path("boom-optimizer/", views.boom_optimizer_page, name="boom_optimizer_page"),
    path("boom-backtest/", views.boom_backtest_page, name="boom_backtest_page"),
    path("boom-visual/", views.boom_visual_page, name="boom_visual_page"),
    path("boom-backtest.pdf", views.boom_backtest_pdf, name="boom_backtest_pdf"),
    path("health", views.m4d_api_forward, {"upstream_relpath": "health"}, name="m4d_health"),
    re_path(r"^v1/(?P<upstream_path>.*)$", views.m4d_v1_forward, name="m4d_v1"),
    re_path(r"^mission/(?P<rest>.*)$", views.mission_spa, name="mission"),
    path("algo-signal/", views.algo_signal_page, name="algo_signal_page"),
    path("algo-optimize/", views.algo_optimize_page, name="algo_optimize_page"),
    path("boom-tearsheet/", views.boom_tearsheet_page, name="boom_tearsheet_page"),
    path("cache/", views.cache_admin_page, name="cache_admin"),
    path("jedi-visual/", views.jedi_visual_page, name="jedi_visual"),
    path("jedi-backtest/", views.jedi_backtest_page, name="jedi_backtest"),
    path("crypto/live/", views.crypto_live_view, name="crypto_live"),
    path("engine/pressure/", views.engine_pressure_view, name="engine_pressure"),
    path("engine/proposals/", views.engine_proposals_view, name="engine_proposals"),
    path("engine/council-stats/", views.engine_council_stats_view, name="engine_council_stats"),
    path("engine/council-stats/write/", views.engine_council_stats_write, name="engine_council_stats_write"),
]
