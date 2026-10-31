/*
 * Chart components, a separate entry point (`@sirat/ui/charts`) so screens without charts never
 * load them. Server-renderable SVG: no client JS, no chart library, colors from tokens only.
 * The package knows nothing about i18n: callers pass data plus already-formatted strings.
 */
export { LineChart, type LineChartPoint, type LineChartProps } from './LineChart';
export { BarList, type BarListItem, type BarListProps } from './BarList';
