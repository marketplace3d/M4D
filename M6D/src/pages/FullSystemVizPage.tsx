import M4DVizDoc from '../viz/FullSystemVizDoc.jsx';

/** CONTROL canvas — full-system diagram (`#control`, alias `#mission`). MAX/4K split deferred. */
export default function FullSystemVizPage() {
  return (
    <div className="viz-center-page" data-mission-wrap="1">
      <M4DVizDoc />
    </div>
  );
}
