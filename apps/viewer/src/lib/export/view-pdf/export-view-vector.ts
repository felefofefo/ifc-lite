/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computePdfScaleLayout, exportToDXF, isOccludedDrawingLine, worldPointToPdfMm } from '@ifc-lite/drawing-2d';
import { generateViewPdf, projectViewDrawing, type ViewPdfExportInput } from './generate-view-pdf';
import { VIEW_PDF_MARGIN_MM } from './view-pdf-page-estimate';
import { pdfLineStyleFor } from '../pdf-line-style';
import { resolveCutPolygonStyle } from '@/components/viewer/drawing/cut-polygon-style';
import { publicationCutSvg } from '../drawing-publication-svg';
import { pdfColor } from '../pdf-color';

export type SavedViewExportFormat = 'dxf' | 'pdf' | 'svg';

export async function exportViewVector(input: ViewPdfExportInput, format: SavedViewExportFormat): Promise<string | Blob> {
  if (format === 'pdf') {
    const assets: Blob[] = [];
    await generateViewPdf({ ...input, renderMode: 'lines' }, { download: blob => { assets.push(blob); } });
    const asset = assets[0];
    if (!asset) throw new Error('The 3D PDF returned no file.');
    return asset;
  }
  const { drawing } = await projectViewDrawing(input);
  const { strokeStyle, scaleFactor, includeHiddenLines, vectorFills } = input;
  if (format === 'dxf') return exportToDXF(drawing, {
    version: 'R2007', showHatching: !!vectorFills, showHiddenLines: includeHiddenLines ?? true,
    hatchLayers: vectorFills && (polygon => {
      const style = resolveCutPolygonStyle(polygon, vectorFills.style);
      return [...(style.fills ?? [{ pattern: 'solid', color: style.fillColor, spacing: 0 }])];
    }),
    objectStyles: !!strokeStyle,
    strokeStyle: strokeStyle && ((element, role, line) => {
      const pen = strokeStyle(element, role, line);
      return { ...pen, dash: pen.dash?.map(mm => mm * scaleFactor / 1000) };
    }),
  });

  const { page, transform } = computePdfScaleLayout(drawing.bounds, scaleFactor, VIEW_PDF_MARGIN_MM);
  const map = (x: number, y: number) => worldPointToPdfMm({ x, y }, transform);
  const fills = vectorFills ? publicationCutSvg(
    drawing.projectionPolygons ?? [], vectorFills.style,
    ({ polygon }) => [polygon.outer, ...polygon.holes].map(ring =>
      ring.map((p, i) => { const q = map(p.x, p.y); return `${i ? 'L' : 'M'}${q.x} ${q.y}`; }).join('') + 'Z').join(''),
    value => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`),
    scaleFactor, mm => mm, 1, map,
  ) : '';
  const lines = drawing.lines.flatMap(line => {
    if (includeHiddenLines === false && isOccludedDrawingLine(line)) return [];
    const pen = strokeStyle?.(line, line.category === 'cut' ? 'cut' : 'projection', line);
    if (pen && !(pen.lineWeight > 0)) return [];
    const { start, end } = line.line;
    const a = worldPointToPdfMm(start, transform), b = worldPointToPdfMm(end, transform);
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return [];
    const defaultPen = pdfLineStyleFor(line.category, line.visibility);
    const dashes = pen ? pen.dash : defaultPen.dash;
    const color = pen && pdfColor(pen.color)?.color;
    const dash = dashes?.length ? ` stroke-dasharray="${dashes.join(' ')}"` : '';
    return [`<path d="M${a.x} ${a.y}L${b.x} ${b.y}" stroke="${color || '#000000'}" stroke-width="${pen?.lineWeight ?? defaultPen.lineWidthMm}"${dash}/>`];
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.widthMm}mm" height="${page.heightMm}mm" viewBox="0 0 ${page.widthMm} ${page.heightMm}" fill="none" stroke-linecap="round">\n${fills}${lines.join('\n')}\n</svg>`;
}
