import {
  Alignment,
  Button,
  Card,
  Classes,
  Dialog,
  H2,
  H4,
  Navbar,
  NavbarDivider,
  NavbarGroup,
  ProgressBar,
  Tab,
  Tabs,
  Tag,
} from "@blueprintjs/core";
import { useMemo, useRef, useState } from "react";

type Metric = {
  label: string;
  value: string;
  sub: string;
  intent?: "success" | "warning" | "danger";
};

const kpis: Metric[] = [
  { label: "YTD RETURN", value: "+18.4%", sub: "Benchmark +7.2%", intent: "success" },
  { label: "SHARPE (TTM)", value: "2.41", sub: "Target > 2.0", intent: "success" },
  { label: "MAX DRAWDOWN", value: "-3.8%", sub: "Limit -8%", intent: "warning" },
  { label: "PORTFOLIO IC", value: "0.068", sub: "Decay half-life 12d", intent: "success" },
];

const signals = [
  { name: "12M momentum", score: 0.091, on: true },
  { name: "5d mean-reversion", score: 0.051, on: true },
  { name: "Earnings revision", score: 0.073, on: true },
  { name: "Vol carry", score: 0.038, on: true },
  { name: "Sentiment NLP", score: 0.062, on: true },
  { name: "Options flow skew", score: 0.022, on: false },
  { name: "Stat-arb pairs", score: 0.085, on: true },
];

const systemDiagrams = [
  {
    file: "worldquant_system_architecture.svg",
    title: "WorldQuant System Architecture",
  },
  {
    file: "alpha_signal_pipeline.svg",
    title: "Alpha Signal Pipeline",
  },
  {
    file: "regime_signal_pipeline_flow.svg",
    title: "Regime Signal Pipeline Flow",
  },
  {
    file: "regime_risk_layer.svg",
    title: "Regime Risk Layer",
  },
  {
    file: "entry_exit_decision_flow.svg",
    title: "Entry / Exit Decision Flow",
  },
];

function App() {
  const [tab, setTab] = useState("war-room");
  const [activeDiagram, setActiveDiagram] = useState<(typeof systemDiagrams)[number] | null>(null);
  const [zoom, setZoom] = useState(1);
  const panRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({ down: false, x: 0, y: 0, left: 0, top: 0 });
  const navSeries = useMemo(
    () =>
      Array.from({ length: 40 }).map((_, i) => {
        const base = 100 + i * 0.22;
        const noise = Math.sin(i * 0.6) * 1.2 + Math.cos(i * 0.22) * 0.9;
        return Math.max(96, base + noise);
      }),
    [],
  );
  const zoomIn = () => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)));
  const resetZoom = () => setZoom(1);

  return (
    <div className={`${Classes.DARK} w3d-root`}>
      <Navbar className="w3d-nav">
        <NavbarGroup align={Alignment.LEFT}>
          <H4 className="w3d-brand">W3D // Quant Trader + Hedge Fund</H4>
          <NavbarDivider />
          <Tag intent="primary" minimal>
            Regime: Risk-On
          </Tag>
          <Tag intent="success" minimal>
            Confidence 82%
          </Tag>
        </NavbarGroup>
        <NavbarGroup align={Alignment.RIGHT}>
          <Button small text="Recompute Weights" />
          <Button small intent="danger" text="Kill Switch" />
        </NavbarGroup>
      </Navbar>

      <main className="w3d-main">
        <Tabs id="w3d-tabs" selectedTabId={tab} onChange={(id) => setTab(String(id))}>
          <Tab id="war-room" title="War Room" />
          <Tab id="signals" title="Signal Factory" />
          <Tab id="risk" title="Risk + Safety" />
          <Tab id="execution" title="Execution" />
        </Tabs>

        <section className="w3d-grid kpi-grid">
          {kpis.map((kpi) => (
            <Card key={kpi.label} className="w3d-card">
              <p className="kpi-label">{kpi.label}</p>
              <p className={`kpi-value ${kpi.intent ?? ""}`}>{kpi.value}</p>
              <p className="kpi-sub">{kpi.sub}</p>
            </Card>
          ))}
        </section>

        <section className="w3d-grid two-col">
          <Card className="w3d-card">
            <H4>Cumulative P&L</H4>
            <div className="sparkline">
              {navSeries.map((v, idx) => (
                <div
                  key={`${v}-${idx}`}
                  className="spark-bar"
                  style={{ height: `${Math.max(10, (v - 95) * 1.2)}px` }}
                />
              ))}
            </div>
          </Card>

          <Card className="w3d-card">
            <H4>Live Alpha Board</H4>
            <div className="signal-list">
              {signals.map((signal) => (
                <div className="signal-row" key={signal.name}>
                  <span>{signal.name}</span>
                  <ProgressBar
                    animate={false}
                    stripes={false}
                    value={Math.min(signal.score / 0.1, 1)}
                    intent={signal.on ? "success" : "danger"}
                  />
                  <Tag minimal intent={signal.on ? "success" : "danger"}>
                    {signal.on ? "ON" : "OFF"}
                  </Tag>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section className="w3d-grid three-col">
          <Card className="w3d-card">
            <H4>Entry / Exit Engine</H4>
            <ul className="clean-list">
              <li>Momentum: ADX &gt; 25 and breakout confirmation</li>
              <li>Mean-Reversion: OU z-score &lt; -1.5 / &gt; +1.5</li>
              <li>Stop stack: ATR, time stop, regime-flip exit</li>
            </ul>
          </Card>
          <Card className="w3d-card">
            <H4>Portfolio Controls</H4>
            <ul className="clean-list">
              <li>Gross 3.2x, Net 0.18x, Beta 0.04</li>
              <li>Signal max weight 40%, soft regime blending</li>
              <li>Sector neutrality + turnover constraints</li>
            </ul>
          </Card>
          <Card className="w3d-card">
            <H4>Hedge Overlay</H4>
            <ul className="clean-list">
              <li>Index put spread: armed</li>
              <li>Variance swap trigger: standby</li>
              <li>Credit hedge (CDX): conditional</li>
            </ul>
          </Card>
        </section>

        <Card className="w3d-card footer-card">
          <H4>System Diagrams (SVG)</H4>
          <p className="kpi-sub">
            Spec source: <code>APPS/BUILD-W3D-DOCS</code>
          </p>
          <div className="diagram-grid">
            {systemDiagrams.map((diagram) => (
              <Card key={diagram.file} className="w3d-card diagram-card">
                <div className="diagram-header">
                  <H4>{diagram.title}</H4>
                  <div className="diagram-actions">
                    <Button
                      small
                      text="View"
                      onClick={() => {
                        setActiveDiagram(diagram);
                        setZoom(1);
                      }}
                    />
                    <a
                      href={`/diagrams/${diagram.file}`}
                      target="_blank"
                      rel="noreferrer"
                      className="diagram-link"
                    >
                      Open
                    </a>
                  </div>
                </div>
                <img
                  className="diagram-preview"
                  src={`/diagrams/${diagram.file}`}
                  alt={diagram.title}
                  loading="lazy"
                />
                <Tag minimal intent="primary">
                  {diagram.file}
                </Tag>
              </Card>
            ))}
          </div>
        </Card>

        <Card className="w3d-card footer-card">
          <H2>W3D Isolated Root Deployed</H2>
          <p>
            This app is standalone in <code>W3D/</code>, uses Blueprint.js dark theme, and is
            isolated from your other root sites.
          </p>
        </Card>
      </main>

      <Dialog
        isOpen={Boolean(activeDiagram)}
        onClose={() => setActiveDiagram(null)}
        title={activeDiagram?.title ?? "Diagram"}
        className={`${Classes.DARK} diagram-modal`}
        canOutsideClickClose
      >
        <div className={Classes.DIALOG_BODY}>
          <div className="diagram-toolbar">
            <Button small text="-" onClick={zoomOut} />
            <Tag minimal>{Math.round(zoom * 100)}%</Tag>
            <Button small text="+" onClick={zoomIn} />
            <Button small text="Reset" onClick={resetZoom} />
          </div>
          <div
            ref={panRef}
            className="diagram-pan-wrap"
            onMouseDown={(event) => {
              const node = panRef.current;
              if (!node) return;
              dragRef.current = {
                down: true,
                x: event.clientX,
                y: event.clientY,
                left: node.scrollLeft,
                top: node.scrollTop,
              };
            }}
            onMouseMove={(event) => {
              const node = panRef.current;
              const drag = dragRef.current;
              if (!node || !drag.down) return;
              node.scrollLeft = drag.left - (event.clientX - drag.x);
              node.scrollTop = drag.top - (event.clientY - drag.y);
            }}
            onMouseUp={() => {
              dragRef.current.down = false;
            }}
            onMouseLeave={() => {
              dragRef.current.down = false;
            }}
          >
            {activeDiagram && (
              <img
                className="diagram-modal-image"
                src={`/diagrams/${activeDiagram.file}`}
                alt={activeDiagram.title}
                style={{ transform: `scale(${zoom})` }}
              />
            )}
          </div>
          <p className="kpi-sub">Drag to pan. Use +/- for zoom.</p>
        </div>
      </Dialog>
    </div>
  );
}

export default App;
