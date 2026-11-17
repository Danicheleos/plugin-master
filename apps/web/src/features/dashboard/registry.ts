import type { FeatureName, Features } from '@pm/protocol';

/** What the dashboard needs to know about a widget type (the components are in `pages/widgets.tsx`). */
export type WidgetMeta = {
  /** Header and menu title. */
  title: string;
  /** Optional feature the widget needs; without it the widget is hidden (its items stay persisted). */
  feature?: FeatureName;
  /** Size in grid cells of a new widget of this type. */
  defaultSize: { w: number; h: number };
};

const OTHER = { w: 6, h: 10 };

/** The widget types, in the order of the "Add widget" menu. */
export const WIDGETS = {
  files: { title: 'Files', defaultSize: { w: 2, h: 20 } },
  editor: { title: 'Editor', defaultSize: { w: 6, h: 12 } },
  evals: { title: 'Evals', defaultSize: { w: 6, h: 8 } },
  chat: { title: 'Agent chat', defaultSize: { w: 4, h: 13 } },
  plan: { title: 'Current plan', defaultSize: { w: 4, h: 7 } },
  runs: { title: 'Runs', defaultSize: OTHER },
  hooks: { title: 'Hooks', defaultSize: OTHER },
  skills: { title: 'Skills', defaultSize: OTHER },
  git: { title: 'Git', feature: 'git', defaultSize: OTHER },
  experiments: {
    title: 'Experiments',
    feature: 'masterLoop',
    defaultSize: OTHER,
  },
  versions: { title: 'Versions', feature: 'git', defaultSize: OTHER },
  graph: { title: 'Structure graph', defaultSize: OTHER },
} as const satisfies Record<string, WidgetMeta>;

export type WidgetType = keyof typeof WIDGETS;
export const WIDGET_TYPES = Object.keys(WIDGETS) as WidgetType[];

export const isWidgetType = (v: unknown): v is WidgetType =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(WIDGETS, v);

export const widgetMeta = (type: WidgetType): WidgetMeta => WIDGETS[type];

/** False when the type's feature is off (or not loaded yet). */
export const widgetEnabled = (type: WidgetType, features?: Features) => {
  const f = widgetMeta(type).feature;
  return !f || !!features?.[f];
};
