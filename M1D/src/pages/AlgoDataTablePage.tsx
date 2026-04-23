import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import AlgoVoteSparkline from '../components/AlgoVoteSparkline';
import { loadCouncilSpec } from '../council';
import type { AlgoTableRow } from '../m4d/algoDayTypes';
import { getAlgoDayUrl } from '../m4d/algoDayTypes';
import {
  algoDataSourceLabel,
  getM4dApiBase,
  getVotesJsonlUrl,
  loadAlgoDayFlexible,
  loadVoteSeriesForAlgo,
} from '../m4d/m4dApi';
import { mergeCouncilAndAlgoDay } from '../m4d/mergeCouncilAlgoDay';
import './AlgoDataTablePage.css';

const col = createColumnHelper<AlgoTableRow>();

/** Per-row TanStack query: compact vote+strength spark (MaxCogViz-style roster trend). */
function TrendCell({ algoId }: { algoId: string }) {
  const apiOrStatic = getM4dApiBase() ?? getVotesJsonlUrl();
  const q = useQuery({
    queryKey: ['mission', 'voteTrend', algoId, apiOrStatic],
    queryFn: async () => {
      const v = await loadVoteSeriesForAlgo(algoId);
      return v.length > 56 ? v.slice(-56) : v;
    },
    staleTime: 60_000,
  });
  if (q.isLoading) {
    return <span className="algo-table__trend algo-table__trend--loading">…</span>;
  }
  if (q.isError) {
    return (
      <span className="algo-table__trend algo-table__trend--err" title={(q.error as Error).message}>
        !
      </span>
    );
  }
  if (!q.data?.length) {
    return <span className="algo-table__trend">—</span>;
  }
  return <AlgoVoteSparkline votes={q.data} width={96} height={34} />;
}

function rowPerfClass(r: AlgoTableRow): string {
  if (r.stub) return '';
  const s = r.lastStrength ?? 0;
  const v = r.lastVote;
  const activity = r.long + r.short;
  if (v != null && v !== 0 && s >= 0.55) return ' algo-table__row--hot';
  if (v != null && v !== 0 && s >= 0.28) return ' algo-table__row--warm';
  if (activity > 0 && s >= 0.42) return ' algo-table__row--warm';
  return '';
}

function voteChar(v: number | null): string {
  if (v === 1) return 'L';
  if (v === -1) return 'S';
  if (v === 0) return '·';
  return '—';
}

function voteClass(v: number | null): string {
  if (v === 1) return 'algo-table__vote--long';
  if (v === -1) return 'algo-table__vote--short';
  if (v === 0) return 'algo-table__vote--flat';
  return 'algo-table__vote--na';
}

const columns = [
  col.accessor('id', {
    header: 'ID',
    cell: (info) => (
      <span className="algo-table__id" style={{ color: info.row.original.color }}>
        {info.getValue()}
      </span>
    ),
  }),
  col.accessor('tier', { header: 'Bank' }),
  col.accessor('name', { header: 'Name' }),
  col.accessor('sub', {
    header: 'Role',
    cell: (info) => <span className="algo-table__sub">{info.getValue()}</span>,
  }),
  col.display({
    id: 'trend',
    header: 'Trend',
    cell: (info) => <TrendCell algoId={info.row.original.id} />,
  }),
  col.accessor('long', { header: 'Long bars' }),
  col.accessor('short', { header: 'Short bars' }),
  col.accessor('flat', { header: 'Flat bars' }),
  col.accessor('lastVote', {
    header: 'Last',
    cell: (info) => (
      <span className={`algo-table__vote ${voteClass(info.getValue())}`}>
        {voteChar(info.getValue())}
      </span>
    ),
  }),
  col.accessor('lastStrength', {
    header: 'Str',
    cell: (info) => {
      const s = info.getValue();
      return s == null ? '—' : s.toFixed(2);
    },
  }),
  col.accessor('stub', {
    header: 'Rust',
    cell: (info) => (info.getValue() ? 'stub' : 'live'),
  }),
];

export default function AlgoDataTablePage() {
  const staticAlgoUrl = getAlgoDayUrl();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error, isError } = useQuery({
    queryKey: ['mission', 'algoDay', getM4dApiBase() ?? staticAlgoUrl],
    queryFn: async () => {
      const [council, day] = await Promise.all([loadCouncilSpec(), loadAlgoDayFlexible(staticAlgoUrl)]);
      const rows = mergeCouncilAndAlgoDay(council, day);
      return { day, rows, source: algoDataSourceLabel() };
    },
    staleTime: 30_000,
  });

  const voteQuery = useQuery({
    queryKey: ['mission', 'voteSeries', selectedId, getM4dApiBase() ?? getVotesJsonlUrl()],
    queryFn: () => loadVoteSeriesForAlgo(selectedId!),
    enabled: selectedId != null,
    staleTime: 60_000,
  });

  const table = useReactTable({
    data: data?.rows ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: { sorting: [{ id: 'id', desc: false }] },
  });

  const onPickRow = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const selectedMeta =
    selectedId && data?.rows ? data.rows.find((r) => r.id === selectedId) : undefined;

  const perfSummary = useMemo(() => {
    if (!selectedMeta) return '';
    const v = selectedMeta.lastVote;
    const dir = v === 1 ? 'long' : v === -1 ? 'short' : v === 0 ? 'flat' : 'n/a';
    const s = selectedMeta.lastStrength ?? 0;
    return `Last bar: ${dir} · strength ${s.toFixed(2)} · tally L/S/F ${selectedMeta.long}/${selectedMeta.short}/${selectedMeta.flat}`;
  }, [selectedMeta]);

  return (
    <div className="algo-data-page">
      <header className="algo-data-page__head">
        <h1 className="algo-data-page__title">ALGO DATA</h1>
        <p className="algo-data-page__sub">
          MaxCogViz council roster · per-row trend (tail of votes) · row edge = participation cue
        </p>
        <div className="algo-data-page__meta">
          {data?.day && (
            <>
              <span className="mono">
                <span className="algo-data-page__srcpill">{data.source}</span> · session{' '}
                {data.day.session_id ?? '—'} · {data.day.symbol} · bars {data.day.bar_count} ·
                warmup {data.day.warmup}
              </span>
              <span className="algo-data-page__src mono" title="Static fallback URL">
                {getM4dApiBase()
                  ? `API ${getM4dApiBase()}`
                  : `static ${staticAlgoUrl}`}
              </span>
            </>
          )}
        </div>
      </header>

      {isLoading && <p className="algo-data-page__msg">Loading council + algo_day…</p>}
      {isError && <p className="algo-data-page__err">{(error as Error).message}</p>}

      {!isLoading && !isError && data && (
        <>
          <div className="algo-data-page__scroll">
            <table className="algo-table">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th
                        key={h.id}
                        className={h.column.id === 'id' ? 'algo-table__th--sticky' : undefined}
                      >
                        {h.isPlaceholder ? null : (
                          <button
                            type="button"
                            className="algo-table__sort"
                            onClick={h.column.getToggleSortingHandler()}
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {h.column.getIsSorted() === 'asc'
                              ? ' ▲'
                              : h.column.getIsSorted() === 'desc'
                                ? ' ▼'
                                : ''}
                          </button>
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => {
                  const id = row.original.id;
                  const sel = selectedId === id;
                  return (
                    <tr
                      key={row.id}
                      className={
                        (sel ? 'algo-table__row algo-table__row--selected' : 'algo-table__row') +
                        rowPerfClass(row.original)
                      }
                      onClick={() => onPickRow(id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onPickRow(id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={sel}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className={
                            cell.column.id === 'id' ? 'algo-table__td--sticky' : undefined
                          }
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <aside
            className="algo-data-page__drill"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {!selectedId && (
              <p className="algo-data-page__hint">Tap a row for vote history + sparkline.</p>
            )}
            {selectedId && selectedMeta && (
              <>
                <div className="algo-data-page__drill-head">
                  <strong style={{ color: selectedMeta.color }}>{selectedMeta.id}</strong>
                  <span className="mono"> {selectedMeta.name}</span>
                </div>
                {perfSummary ? (
                  <p className="algo-data-page__perf mono" id="algo-drill-perf">
                    {perfSummary}
                  </p>
                ) : null}
                {voteQuery.isLoading && <p className="algo-data-page__msg">Loading votes…</p>}
                {voteQuery.isError && (
                  <p className="algo-data-page__err">{(voteQuery.error as Error).message}</p>
                )}
                {voteQuery.data && (
                  <>
                    <p className="algo-data-page__drill-meta mono">
                      {voteQuery.data.length} bars · teal = strength · dots = vote (L/·/S)
                    </p>
                    <AlgoVoteSparkline votes={voteQuery.data} />
                  </>
                )}
              </>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
