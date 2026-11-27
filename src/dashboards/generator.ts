import type { VarkenConfig } from '../config/schemas/config.schema';
import { type BandSpec, type DashboardSpec, type OutputKey, type PanelSpec, type PanelTemplate, type PlexPairing, type ResolvedSource, TABLE_SHAPES, type Variant } from './model';
import { OVERVIEW } from './overview';
import { resolveSources, type SourceContext } from './sources';
import { DATASOURCE_UID, getTranslator, usableSources, type GrafanaTarget, type TargetContext, type Translator } from './translators';

export const MIN_GRAFANA_VERSION = '11.0.0';
const GRID_WIDTH = 24;

export interface GrafanaPanel {
  id: number;
  type: string;
  title: string;
  gridPos: { x: number; y: number; w: number; h: number };
  datasource?: { type: string; uid: string };
  targets?: GrafanaTarget[];
  interval?: string;
  timeFrom?: string;
  hideTimeOverride?: boolean;
  [key: string]: unknown;
}

export interface GrafanaDashboard {
  __inputs: object[];
  __requires: object[];
  uid: string;
  title: string;
  description: string;
  tags: string[];
  panels: GrafanaPanel[];
  [key: string]: unknown;
}

export interface GenerateOptions {
  kind: DashboardSpec['kind'];
  output: OutputKey;
  config: Pick<VarkenConfig, 'inputs' | 'global'>;
  pairedPlex: PlexPairing;
  version: string;
  /** Time zone of hour-of-day and weekday buckets; defaults to UTC. */
  timezone?: string;
  /** Defaults to the dashboard of `kind`. */
  spec?: DashboardSpec;
}

const SPECS: Record<DashboardSpec['kind'], DashboardSpec> = { overview: OVERVIEW };

interface Rendered {
  spec: PanelSpec;
  template: PanelTemplate;
  variant: Variant;
  sources: ResolvedSource[];
}

function choose(panel: PanelSpec, translator: Translator, ctx: SourceContext): Rendered | undefined {
  for (const variant of panel.variants) {
    const resolved = variant.sources.flatMap((source) => resolveSources(source, ctx));
    const sources = usableSources(translator, variant.query, resolved);
    if (sources.length > 0 && (!variant.complete || sources.length === resolved.length)) {
      return { spec: panel, template: { ...panel.grafana, ...variant.grafana }, variant, sources };
    }
  }
  return undefined;
}

const refId = (index: number): string => (index < 26 ? String.fromCharCode(65 + index) : `${refId(Math.floor(index / 26) - 1)}${refId(index % 26)}`);

/** Places panels left to right, a new line when the next one does not fit. */
class Flow {
  private x = 0;
  private lineHeight = 0;
  constructor(public y: number) {}

  place(width: number, height: number): GrafanaPanel['gridPos'] {
    if (this.x + width > GRID_WIDTH) {
      this.newLine();
    }
    const pos = { x: this.x, y: this.y, w: width, h: height };
    this.x += width;
    this.lineHeight = Math.max(this.lineHeight, height);
    return pos;
  }

  newLine(): void {
    this.y += this.lineHeight;
    this.x = 0;
    this.lineHeight = 0;
  }
}

function panelJson(rendered: Rendered, band: BandSpec, translator: Translator, ctx: TargetContext, id: number, gridPos: GrafanaPanel['gridPos']): GrafanaPanel {
  const { template, variant, sources } = rendered;
  const { type, title, transformations, ...grafana } = template;
  const prelude = TABLE_SHAPES.has(variant.query.shape) ? (translator.tableTransformations ?? []) : [];
  const allTransformations = [...prelude, ...(transformations ?? [])];
  const panel: GrafanaPanel = {
    id,
    type,
    title: title ?? rendered.spec.title,
    gridPos,
    datasource: { type: translator.datasource.pluginId, uid: DATASOURCE_UID },
    targets: sources.map((source, index) => translator.target(variant.query, source, refId(index), ctx)),
    fieldConfig: { defaults: {}, overrides: [] },
    ...grafana,
    ...(allTransformations.length > 0 ? { transformations: allTransformations } : {}),
  };
  if (variant.query.shape === 'timeSeries' && variant.query.bucket === 'auto') {
    panel.interval = `${Math.max(...sources.map((source) => source.intervalSeconds))}s`;
  }
  if (band.fixedWindow) {
    panel.timeFrom = band.fixedWindow;
    panel.hideTimeOverride = true;
  }
  return panel;
}

/** A line left short by omitted panels shares the full width, in proportion to the panels' widths. */
function stretchLines(panels: GrafanaPanel[]): void {
  const lines = new Map<number, GrafanaPanel[]>();
  for (const panel of panels) {
    lines.set(panel.gridPos.y, [...(lines.get(panel.gridPos.y) ?? []), panel]);
  }
  for (const line of lines.values()) {
    const used = line.reduce((sum, panel) => sum + panel.gridPos.w, 0);
    if (used >= GRID_WIDTH) {
      continue;
    }
    const widths = line.map((panel) => Math.floor((panel.gridPos.w * GRID_WIDTH) / used));
    let spare = GRID_WIDTH - widths.reduce((sum, w) => sum + w, 0);
    let x = 0;
    line.forEach((panel, index) => {
      const w = widths[index] + (spare > 0 ? 1 : 0);
      spare -= 1;
      panel.gridPos = { ...panel.gridPos, x, w };
      x += w;
    });
  }
}

/** Grafana dashboard JSON of the panels the config feeds, importable through Grafana's import screen. */
export function generateDashboard(options: GenerateOptions): GrafanaDashboard {
  const translator = getTranslator(options.output);
  const ctx: SourceContext = { config: options.config, pairedPlex: options.pairedPlex };
  const targetCtx: TargetContext = { timezone: options.timezone ?? 'UTC' };
  const panels: GrafanaPanel[] = [];
  const flow = new Flow(0);
  const spec = options.spec ?? SPECS[options.kind];
  for (const band of spec.bands) {
    const rendered = band.panels.map((panel) => choose(panel, translator, ctx)).filter((r): r is Rendered => r !== undefined);
    if (rendered.length === 0) {
      continue;
    }
    flow.newLine();
    panels.push({ id: panels.length + 1, type: 'row', title: band.title, collapsed: false, gridPos: flow.place(GRID_WIDTH, 1), panels: [] });
    flow.newLine();
    const placed = rendered.map((r, index) => {
      if (index > 0 && rendered[index - 1].template.type === 'stat' && r.template.type !== 'stat') {
        flow.newLine();
      }
      const [width, height] = r.variant.size ?? [r.spec.width, r.spec.height];
      return panelJson(r, band, translator, targetCtx, panels.length + 1 + index, flow.place(width, height));
    });
    stretchLines(placed);
    panels.push(...placed);
  }
  const panelTypes = [...new Set(panels.map((panel) => panel.type).filter((type) => type !== 'row'))].sort();
  return {
    __inputs: [
      {
        name: 'DS_VARKEN',
        label: translator.datasource.label,
        description: '',
        type: 'datasource',
        pluginId: translator.datasource.pluginId,
        pluginName: translator.datasource.pluginName,
      },
    ],
    __requires: [
      { type: 'grafana', id: 'grafana', name: 'Grafana', version: MIN_GRAFANA_VERSION },
      { type: 'datasource', id: translator.datasource.pluginId, name: translator.datasource.pluginName, version: '1.0.0' },
      ...panelTypes.map((type) => ({ type: 'panel', id: type, name: type, version: '' })),
    ],
    uid: `varken-${options.kind}-${options.output}`,
    title: spec.title,
    description: `Generated by Varken ${options.version}`,
    tags: ['varken'],
    editable: true,
    graphTooltip: 1,
    schemaVersion: 41,
    time: { from: 'now-7d', to: 'now' },
    refresh: '1m',
    annotations: { list: [] },
    templating: { list: [] },
    panels,
  };
}
