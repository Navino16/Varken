import type { VarkenConfig } from '../config/schemas/config.schema';
import type { BandSpec, DashboardSpec, OutputKey, PanelSpec, PanelTemplate, ResolvedSource, Variant } from './model';
import { resolveSources, type SourceContext } from './sources';
import { DATASOURCE_UID, getTranslator, usableSources, type GrafanaTarget, type Translator } from './translators';

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
  pairedPlex: ReadonlySet<number>;
  version: string;
  spec: DashboardSpec;
}

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
    if (sources.length > 0) {
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

function panelJson(rendered: Rendered, band: BandSpec, translator: Translator, id: number, gridPos: GrafanaPanel['gridPos']): GrafanaPanel {
  const { template, variant, sources } = rendered;
  const { type, title, ...grafana } = template;
  const panel: GrafanaPanel = {
    id,
    type,
    title: title ?? rendered.spec.title,
    gridPos,
    datasource: { type: translator.datasource.pluginId, uid: DATASOURCE_UID },
    targets: sources.map((source, index) => translator.target(variant.query, source, refId(index))),
    fieldConfig: { defaults: {}, overrides: [] },
    ...grafana,
  };
  if (variant.query.shape === 'timeSeries' && variant.query.bucket === 'auto') {
    panel.interval = `${Math.max(...sources.map((source) => source.intervalSeconds))}s`;
  }
  if (band.fixedWindow) {
    panel.timeFrom = band.fixedWindow;
    panel.hideTimeOverride = false;
  }
  return panel;
}

/** Grafana dashboard JSON of the panels the config feeds, importable through Grafana's import screen. */
export function generateDashboard(options: GenerateOptions): GrafanaDashboard {
  const translator = getTranslator(options.output);
  const ctx: SourceContext = { config: options.config, pairedPlex: options.pairedPlex };
  const panels: GrafanaPanel[] = [];
  const flow = new Flow(0);
  for (const band of options.spec.bands) {
    const rendered = band.panels.map((panel) => choose(panel, translator, ctx)).filter((r): r is Rendered => r !== undefined);
    if (rendered.length === 0) {
      continue;
    }
    flow.newLine();
    panels.push({ id: panels.length + 1, type: 'row', title: band.title, collapsed: false, gridPos: flow.place(GRID_WIDTH, 1), panels: [] });
    flow.newLine();
    for (const r of rendered) {
      panels.push(panelJson(r, band, translator, panels.length + 1, flow.place(r.spec.width, r.spec.height)));
    }
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
    title: options.spec.title,
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
