/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { patternSegments, surfacePatternSegments, type DrawingPolygon, type Point2D } from '@ifc-lite/drawing-2d';
import { styleCutPolygons, type CutPolygonStyleContext } from '@/components/viewer/drawing/cut-polygon-style';

export function svgDash(dash: readonly number[] | undefined, mmToTarget: (mm: number) => number): string {
  return dash?.length ? ` stroke-dasharray="${dash.map((part) => mmToTarget(part).toFixed(4)).join(' ')}"` : '';
}

export function publicationCutSvg(
  polygons: readonly DrawingPolygon[],
  context: CutPolygonStyleContext,
  path: (polygon: DrawingPolygon) => string,
  escape: (value: string) => string,
  scale: number,
  mmToTarget: (mm: number) => number,
  legacyOutlineFactor = 1,
  map?: (x: number, y: number) => Point2D,
): string {
  const patterns = new Map<string, { id: string; markup: string }>();
  let fills = '';
  let outlines = '';
  for (const { polygon, style, geometry } of styleCutPolygons(polygons, context, path)) {
    if (!geometry) continue;
    const attributes = `d="${geometry}" fill-rule="evenodd"`;
    const entity = `data-entity-id="${polygon.entityId}" data-ifc-type="${escape(polygon.ifcType)}"`;
    if (!style.fills) {
      fills += `<path ${attributes} fill="${escape(style.fillColor)}" fill-opacity="${style.fillOpacity.toFixed(2)}" ${entity}/>\n`;
    } else {
      for (const paint of style.fills) {
        if (paint.pattern === 'solid') {
          fills += `<path ${attributes} fill="${escape(paint.color)}" ${entity}/>\n`;
          continue;
        }
        const spacing = mmToTarget(paint.spacing * 1000 / scale);
        const width = mmToTarget(paint.lineWeight ?? 0.13);
        if (!(spacing > 0) || !Number.isFinite(spacing)) continue;
        if (polygon.surfacePatternTransform && map) {
          const segments = surfacePatternSegments(polygon, { ...paint, pattern: paint.pattern });
          const d = segments.map(({ start, end }) => {
            const a = map(start.x, start.y), b = map(end.x, end.y);
            return `M${a.x} ${a.y}L${b.x} ${b.y}`;
          }).join('');
          fills += `<path d="${d}" fill="none" stroke="${escape(paint.color)}" stroke-width="${width}" ${entity}/>
`;
          continue;
        }
        if (paint.pattern === 'custom') {
          if (!map) continue;
          const ring = (points: Point2D[]) => points.map(p => { const q = map(p.x, p.y); return { x: q.x, y: -q.y }; });
          const segments = patternSegments({ outer: ring(polygon.polygon.outer), holes: polygon.polygon.holes.map(ring) }, paint.families ?? [], spacing);
          const d = segments.map(({ start, end }) => `M${start.x} ${-start.y}L${end.x} ${-end.y}`).join('');
          fills += `<path d="${d}" fill="none" stroke="${escape(paint.color)}" stroke-width="${width}" ${entity}/>
`;
          continue;
        }
        for (const angle of paint.pattern === 'cross-hatch' ? [-45, 45] : [-45]) {
          const key = JSON.stringify([spacing, width, angle, paint.color]);
          let pattern = patterns.get(key);
          if (!pattern) {
            const id = `ifc-cut-pattern-${patterns.size + 1}`;
            const markup = `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${spacing}" height="${spacing}" patternTransform="rotate(${angle})"><path d="M0 0H${spacing} M0 ${spacing}H${spacing}" stroke="${escape(paint.color)}" stroke-width="${width}" fill="none"/></pattern>\n`;
            pattern = { id, markup };
            patterns.set(key, pattern);
          }
          fills += `<path ${attributes} fill="url(#${pattern.id})" ${entity}/>\n`;
        }
      }
    }
    const weight = mmToTarget(style.lineWeight) * (context.stroke ? 1 : legacyOutlineFactor);
    const outline = polygon.cutOutline && map ? polygon.cutOutline.map(({ start, end }) => {
      const a = map(start.x, start.y), b = map(end.x, end.y);
      return `M${a.x} ${a.y}L${b.x} ${b.y}`;
    }).join('') : geometry;
    if (weight > 0 && outline) outlines += `<path d="${outline}" fill="none" stroke="${escape(style.strokeColor)}" stroke-width="${weight.toFixed(4)}"${svgDash(style.dash, mmToTarget)} data-entity-id="${polygon.entityId}"/>\n`;
  }
  return `<defs>${[...patterns.values()].map(({ markup }) => markup).join('')}</defs>\n<g id="polygon-fills">\n${fills}</g>\n<g id="polygon-outlines">\n${outlines}</g>\n`;
}
