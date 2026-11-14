/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { GraphicOverrideEngine, LINE_STYLE_PRESET_DASHES, getLineStyle, LINE_WEIGHT_VALUES, makeEntityKey, resolveObjectStyle, type DXFExportOptions } from '@ifc-lite/drawing-2d';
import { distantColor, type DistantElements } from '@/lib/drawing/distant-elements';
import type { CutPolygonStyleContext } from '@/components/viewer/drawing/cut-polygon-style';
import { LINEWEIGHT_PRESETS, type LineweightRow } from '@/lib/drawing/lineweight-table';

export function drawingPublicationStrokeStyle(
  lineweights: LineweightRow | undefined,
  { overridesEnabled, overrideEngine, getElementProperties }: Pick<CutPolygonStyleContext, 'overridesEnabled' | 'overrideEngine' | 'getElementProperties'>,
  distant?: DistantElements,
): DXFExportOptions['strokeStyle'] {
  const rules = overrideEngine.getRules();
  const styles = new Map<string, ReturnType<NonNullable<DXFExportOptions['strokeStyle']>>>();
  const resolve: NonNullable<DXFExportOptions['strokeStyle']> = (element, role, drawingLine) => {
    if (drawingLine?.category === 'annotation') {
      const base = getLineStyle('annotation', element.ifcType);
      return { color: base.color, lineWeight: base.weight, dash: base.dashPattern };
    }
    const objectStyle = resolveObjectStyle(element.ifcType);
    const line = role === 'cut' ? objectStyle.cutLines : objectStyle.projectionLines;
    const preset = LINEWEIGHT_PRESETS.find((name) => LINE_WEIGHT_VALUES[name] === line.lineWeight);
    const hidden = drawingLine?.visibility === 'hidden' || drawingLine?.category === 'hidden';
    const obscured = hidden ? getLineStyle('hidden', element.ifcType) : undefined;
    const base = obscured ? { color: obscured.color, lineWeight: obscured.weight, dash: obscured.dashPattern }
      : { color: line.lineColor, lineWeight: preset && lineweights ? lineweights[preset] : line.lineWeight, dash: LINE_STYLE_PRESET_DASHES[line.linePattern] };
    if (!overridesEnabled || !rules.length) return base;

    const key = `${role}:${hidden}:${makeEntityKey(element.modelIndex, element.entityId)}`;
    const cached = styles.get(key);
    if (cached) return cached;
    const data = { expressId: element.entityId, ifcType: element.ifcType, properties: getElementProperties(element.entityId) };
    const matches = role === 'projection' ? overrideEngine.getMatchingRules(data) : [];
    const engine = role === 'cut' ? overrideEngine : new GraphicOverrideEngine(matches.map(rule => ({
      ...rule, criteria: { type: 'all' }, style: {
        lineWeight: rule.style.projectionLineWeight, lineStyle: rule.style.projectionLineStyle,
      },
    })), lineweights);
    const { style } = engine.applyOverrides(data,
      { strokeColor: base.color, lineWeight: base.lineWeight, lineStyle: { custom: base.dash } });
    const dash = style.dashPattern;
    const resolved = { color: style.strokeColor, lineWeight: style.lineWeight,
      dash: dash.length % 2 === 0 && dash.every((part) => Number.isFinite(part) && part > 0) ? dash : base.dash };
    styles.set(key, resolved);
    return resolved;
  };
  return (element, role, line) => {
    const pen = resolve(element, role, line);
    return line?.distant && distant ? { ...pen, color: distantColor(pen.color, distant), lineWeight: distant.weight ?? pen.lineWeight } : pen;
  };
}
