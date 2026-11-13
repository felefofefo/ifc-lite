/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { LINE_STYLE_PRESET_DASHES, getLineStyle, LINE_WEIGHT_VALUES, makeEntityKey, resolveObjectStyle, type DXFExportOptions } from '@ifc-lite/drawing-2d';
import type { CutPolygonStyleContext } from '@/components/viewer/drawing/cut-polygon-style';
import { LINEWEIGHT_PRESETS, type LineweightRow } from '@/lib/drawing/lineweight-table';

export function drawingPublicationStrokeStyle(
  lineweights: LineweightRow | undefined,
  { overridesEnabled, overrideEngine, getElementProperties }: CutPolygonStyleContext,
): DXFExportOptions['strokeStyle'] {
  const cutStyles = new Map<string, ReturnType<NonNullable<DXFExportOptions['strokeStyle']>>>();
  return (element, role, drawingLine) => {
    if (drawingLine?.visibility === 'hidden' || drawingLine?.category === 'hidden' || drawingLine?.category === 'annotation') {
      const hidden = drawingLine.visibility === 'hidden' || drawingLine.category === 'hidden';
      const base = getLineStyle(hidden ? 'hidden' : 'annotation', element.ifcType);
      return { color: base.color, lineWeight: base.weight, dash: base.dashPattern };
    }
    const objectStyle = resolveObjectStyle(element.ifcType);
    const line = role === 'cut' ? objectStyle.cutLines : objectStyle.projectionLines;
    const preset = LINEWEIGHT_PRESETS.find((name) => LINE_WEIGHT_VALUES[name] === line.lineWeight);
    const base = { color: line.lineColor, lineWeight: preset && lineweights ? lineweights[preset] : line.lineWeight, dash: LINE_STYLE_PRESET_DASHES[line.linePattern] };
    if (role !== 'cut' || !overridesEnabled) return base;

    const key = makeEntityKey(element.modelIndex, element.entityId);
    const cached = cutStyles.get(key);
    if (cached) return cached;
    const { style } = overrideEngine.applyOverrides({
      expressId: element.entityId,
      ifcType: element.ifcType,
      properties: getElementProperties(element.entityId),
    }, { strokeColor: base.color, lineWeight: base.lineWeight, lineStyle: { custom: base.dash } });
    const dash = style.dashPattern;
    const resolved = { color: style.strokeColor, lineWeight: style.lineWeight,
      dash: dash.length % 2 === 0 && dash.every((part) => Number.isFinite(part) && part > 0) ? dash : base.dash };
    cutStyles.set(key, resolved);
    return resolved;
  };
}
