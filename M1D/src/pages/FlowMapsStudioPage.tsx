import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import controlRoomSvgRaw from '../assets/controlroom_review.svg?raw';
import signalLayerSvgRaw from '../assets/maxjedialpha_iteropt_map.svg?raw';

type MapKey = 'control' | 'signal';

type SeedFlow = {
  nodes: Node[];
  edges: Edge[];
};

const MAPS: Record<MapKey, { label: string; raw: string }> = {
  control: { label: 'CONTROL ROOM REVIEW', raw: controlRoomSvgRaw },
  signal: { label: 'MAXJEDIALPHA SIGNAL MAP', raw: signalLayerSvgRaw },
};

function getRectTextLabels(group: Element, rect: SVGRectElement): string[] {
  const rx = Number(rect.getAttribute('x') ?? '0');
  const ry = Number(rect.getAttribute('y') ?? '0');
  const rw = Number(rect.getAttribute('width') ?? '0');
  const rh = Number(rect.getAttribute('height') ?? '0');
  return Array.from(group.querySelectorAll(':scope > text'))
    .map((el) => el as SVGTextElement)
    .filter((t) => {
      const tx = Number(t.getAttribute('x') ?? '0');
      const ty = Number(t.getAttribute('y') ?? '0');
      return tx >= rx - 12 && tx <= rx + rw + 12 && ty >= ry - 8 && ty <= ry + rh + 20;
    })
    .map((t) => (t.textContent ?? '').trim())
    .filter(Boolean);
}

function nearestNodeId(nodes: Node[], x: number, y: number, maxDistance = 110): string | null {
  let bestId: string | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    const w = (n.style?.width as number) ?? 160;
    const h = (n.style?.height as number) ?? 64;
    const cx = n.position.x + w / 2;
    const cy = n.position.y + h / 2;
    const d = Math.hypot(cx - x, cy - y);
    if (d < best && d <= maxDistance) {
      best = d;
      bestId = n.id;
    }
  }
  return bestId;
}

function parseSvgToFlow(rawSvg: string, mapKey: MapKey): SeedFlow {
  const doc = new DOMParser().parseFromString(rawSvg, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return { nodes: [], edges: [] };

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let nodeCounter = 0;
  let edgeCounter = 0;

  const addRectNode = (rect: SVGRectElement, labels: string[], idPrefix: string) => {
    const x = Number(rect.getAttribute('x') ?? '0');
    const y = Number(rect.getAttribute('y') ?? '0');
    const width = Number(rect.getAttribute('width') ?? '160');
    const height = Number(rect.getAttribute('height') ?? '64');
    if (width < 40 || height < 20) return;
    const styleAttr = rect.getAttribute('style') ?? '';
    const fill = /fill:([^;]+)/.exec(styleAttr)?.[1]?.trim() ?? '#1f2937';
    const stroke = /stroke:([^;]+)/.exec(styleAttr)?.[1]?.trim() ?? '#64748b';
    const label = labels.join('\n').trim() || `${idPrefix} ${nodeCounter + 1}`;
    nodes.push({
      id: `${idPrefix}-${nodeCounter++}`,
      position: { x, y },
      data: { label },
      style: {
        width,
        height,
        background: fill,
        color: '#e5e7eb',
        border: `1px solid ${stroke}`,
        borderRadius: 10,
        whiteSpace: 'pre-line',
        fontSize: 12,
        lineHeight: 1.25,
        padding: 8,
      },
      draggable: true,
      selectable: true,
    });
  };

  const groups = Array.from(svg.querySelectorAll('g'));
  for (const group of groups) {
    if (group.closest('defs')) continue;
    const rect = group.querySelector(':scope > rect') as SVGRectElement | null;
    if (!rect) continue;
    addRectNode(rect, getRectTextLabels(group, rect), mapKey);
  }

  const topRects = Array.from(svg.querySelectorAll(':scope > rect')).filter(
    (el) => !(el as Element).closest('defs')
  ) as SVGRectElement[];
  for (const rect of topRects) {
    const x = Number(rect.getAttribute('x') ?? '0');
    const y = Number(rect.getAttribute('y') ?? '0');
    const width = Number(rect.getAttribute('width') ?? '0');
    const labels = Array.from(svg.querySelectorAll(':scope > text'))
      .map((el) => el as SVGTextElement)
      .filter((t) => {
        const tx = Number(t.getAttribute('x') ?? '0');
        const ty = Number(t.getAttribute('y') ?? '0');
        return tx >= x && tx <= x + width && ty >= y - 2 && ty <= y + 28;
      })
      .map((t) => (t.textContent ?? '').trim())
      .filter(Boolean);
    if (labels.length > 0) {
      addRectNode(rect, labels, mapKey);
    }
  }

  const connectorLines = Array.from(svg.querySelectorAll('line[marker-end]'));
  for (const line of connectorLines) {
    if (line.closest('defs')) continue;
    const x1 = Number(line.getAttribute('x1') ?? '0');
    const y1 = Number(line.getAttribute('y1') ?? '0');
    const x2 = Number(line.getAttribute('x2') ?? '0');
    const y2 = Number(line.getAttribute('y2') ?? '0');
    const source = nearestNodeId(nodes, x1, y1);
    const target = nearestNodeId(nodes, x2, y2);
    if (!source || !target || source === target) continue;
    edges.push({
      id: `${mapKey}-e-${edgeCounter++}`,
      source,
      target,
      animated: true,
      style: { stroke: '#9ca3af', strokeWidth: 1.4 },
    });
  }

  return { nodes, edges };
}

export default function FlowMapsStudioPage() {
  const [activeMap, setActiveMap] = useState<MapKey>('control');
  const seed = useMemo(() => parseSvgToFlow(MAPS[activeMap].raw, activeMap), [activeMap]);
  const [flowRef, setFlowRef] = useState<ReactFlowInstance<Node, Edge> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(seed.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(seed.edges);

  const freshSeed = useMemo(
    () => ({
      nodes: seed.nodes.map((n) => ({ ...n, position: { ...n.position } })),
      edges: seed.edges.map((e) => ({ ...e })),
    }),
    [seed]
  );

  useEffect(() => {
    setNodes(freshSeed.nodes);
    setEdges(freshSeed.edges);
    requestAnimationFrame(() => {
      flowRef?.fitView({ padding: 0.15, duration: 240 });
    });
  }, [flowRef, freshSeed.edges, freshSeed.nodes, setEdges, setNodes]);

  return (
    <div style={{ height: 'calc(100dvh - 96px)', background: '#030712' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={setFlowRef}
        fitView
      >
        <Panel
          position="top-left"
          style={{
            background: 'rgba(3, 7, 18, 0.88)',
            color: '#e2e8f0',
            border: '1px solid #334155',
            borderRadius: 10,
            padding: 10,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <strong style={{ fontSize: 12, letterSpacing: '0.08em' }}>MAP STUDIO</strong>
          <button type="button" onClick={() => setActiveMap('control')}>
            ControlRoom
          </button>
          <button type="button" onClick={() => setActiveMap('signal')}>
            SignalLayer
          </button>
          <button
            type="button"
            onClick={() => {
              setNodes(freshSeed.nodes);
              setEdges(freshSeed.edges);
              requestAnimationFrame(() => {
                flowRef?.fitView({ padding: 0.15, duration: 240 });
              });
            }}
          >
            Reset Layout
          </button>
          <span style={{ fontSize: 11, opacity: 0.8 }}>{MAPS[activeMap].label}</span>
        </Panel>
        <MiniMap pannable zoomable style={{ background: '#0b1222' }} />
        <Controls />
        <Background gap={16} size={1} color="#1f2937" />
      </ReactFlow>
    </div>
  );
}
