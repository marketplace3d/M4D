import './MaxJediSignalAppendixPage.css';

const REPO = 'spec-kit/docs';
const AGENT = 'agent';

/** Appendix mirroring `spec-kit/AI in/MAXJEDIALPHA_signal_layer_map.html` page 2 — specs, links, §8 smoke. */
export default function MaxJediSignalAppendixPage() {
  return (
    <div className="mjsa">
      <header className="mjsa__head">
        <div>
          <h1 className="mjsa__title">MAXJEDIALPHA</h1>
          <p className="mjsa__kicker">APPENDIX · SPECS · LINKS · VERIFICATION</p>
          <p className="mjsa__sub">Signal layer map · pair with HTML map · keep docs in sync</p>
        </div>
        <div className="mjsa__meta">
          <div>
            PAGE <span>2 / 2</span>
          </div>
          <div>
            PAIR <span>MAXJEDIALPHA.md §8</span>
          </div>
          <div>
            CONTEXT <span>spec-kit/CONTEXT.md</span>
          </div>
        </div>
      </header>

      <p className="mjsa__section-label">Canonical prose + progress</p>
      <div className="mjsa__grid mjsa__grid--2">
        <article className="mjsa__card">
          <p className="mjsa__card-id mjsa__card-id--cyan">PRIMARY SPEC</p>
          <h2 className="mjsa__card-name">MAXJEDIALPHA.md</h2>
          <p className="mjsa__card-desc">
            Layer stack, formulas, constant matrix, iter-opt playbook,{' '}
            <strong>§8 progress &amp; how to test</strong> (smoke scripts, curl probes).
          </p>
          <p className="mjsa__path">{REPO}/MAXJEDIALPHA.md</p>
        </article>
        <article className="mjsa__card">
          <p className="mjsa__card-id mjsa__card-id--purple">TASK TRACKER</p>
          <h2 className="mjsa__card-name">MISSION_CONTROL_RUST_DATAFLOW_TASKS</h2>
          <p className="mjsa__card-desc">
            Phased delivery; MAXJEDIALPHA verification checklist. Tick when phases complete.
          </p>
          <p className="mjsa__path">{REPO}/MISSION_CONTROL_RUST_DATAFLOW_TASKS.md</p>
        </article>
      </div>

      <p className="mjsa__section-label">Alpha hunt &amp; inputs backlog</p>
      <div className="mjsa__grid mjsa__grid--2">
        <article className="mjsa__card">
          <p className="mjsa__card-id mjsa__card-id--amber">ROADMAP</p>
          <h2 className="mjsa__card-name">ALPHA_HUNT_INPUTS_AND_LAYERS</h2>
          <p className="mjsa__card-desc">
            27 roster table, proposed layers, data sources, anti-patterns. Points to §8 for runnable
            verification.
          </p>
          <p className="mjsa__path">{REPO}/ALPHA_HUNT_INPUTS_AND_LAYERS.md</p>
        </article>
        <article className="mjsa__card">
          <p className="mjsa__card-id mjsa__card-id--green">LIVE DATA · CHARTS</p>
          <h2 className="mjsa__card-name">LIVE_DATA_ALGOS_VOTES_CHARTS</h2>
          <p className="mjsa__card-desc">Snapshot vs streaming, API shapes, MISSION charts embed notes.</p>
          <p className="mjsa__path">{REPO}/LIVE_DATA_ALGOS_VOTES_CHARTS.md</p>
        </article>
      </div>

      <p className="mjsa__section-label">Quick verification (§8 · smoke)</p>
      <div className="mjsa__table-wrap">
        <table className="mjsa__table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Action</th>
              <th>Expect</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className="mjsa__knob mjsa__knob--cyan">API health</span>
              </td>
              <td>
                <code className="mjsa__code">curl -s localhost:3330/health</code>
              </td>
              <td>HTTP 200 · JSON OK</td>
            </tr>
            <tr>
              <td>
                <span className="mjsa__knob mjsa__knob--purple">Algo day</span>
              </td>
              <td>
                <code className="mjsa__code">curl -s localhost:3330/v1/algo-day | head -c 200</code>
              </td>
              <td>Tallies + last-bar fields present</td>
            </tr>
            <tr>
              <td>
                <span className="mjsa__knob mjsa__knob--amber">Exec probe</span>
              </td>
              <td>MISSION council → weighted consensus path (paper)</td>
              <td>Banks 0.2 / 0.3 / 0.5 · λ blend consistent</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mjsa__section-label">HTML signal map (print)</p>
      <article className="mjsa__card mjsa__card--wide">
        <p className="mjsa__card-id mjsa__card-id--muted">STATIC VISUAL</p>
        <h2 className="mjsa__card-name">MAXJEDIALPHA_signal_layer_map.html</h2>
        <p className="mjsa__card-desc">
          Full iter-opt reference (banks, traffic light, knobs, sequence). Open in browser → Print / Save
          PDF. This TSX page is the appendix only (page 2).
        </p>
        <p className="mjsa__path">spec-kit/AI in/MAXJEDIALPHA_signal_layer_map.html</p>
      </article>

      <p className="mjsa__section-label">Changelog · agent hub</p>
      <article className="mjsa__card mjsa__card--hub">
        <p className="mjsa__card-id mjsa__card-id--muted">REPO HUB</p>
        <ul className="mjsa__hub-list">
          <li>
            <span className="mjsa__hub-k">agent/README.md</span> — Cursor <strong>@agent</strong> · rules{' '}
            <span className="mjsa__hub-muted">{AGENT}/AGENTS.md</span>
          </li>
          <li>
            <span className="mjsa__hub-k">{AGENT}/CHANGELOG_AI.md</span> — what shipped (newest first)
          </li>
          <li>
            <span className="mjsa__hub-k">{AGENT}/AWARENESS.md</span> — atlas: trust order, surfaces
          </li>
        </ul>
      </article>

      <footer className="mjsa__foot">
        <span>M4D · MAXJEDIALPHA · APPENDIX</span>
        <span>HASH #maxjedi · BANKS A:B:C w=0.2:0.3:0.5</span>
        <span>MISSION REACT</span>
      </footer>
    </div>
  );
}
