/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  DxfWriter as CadWriter, HatchBoundaryPaths, HatchPredefinedPatterns, LWPolylineFlags,
  PathTypeFlag, TextHorizontalAlignment, TextVerticalAlignment, Units, point3d,
  type Dxfier,
} from '@tarikjabiri/dxf';
import { cssToAci } from './aci-colors.js';
import { DxfWriter, type DxfLinetype, type DxfTextHAlign, type DxfTextVAlign } from './writer.js';
import type { Point2D } from '../types.js';

const toPoint3d = ({ x, y }: Point2D) => point3d(x, y, 0);
const horizontal = { left: TextHorizontalAlignment.Left, center: TextHorizontalAlignment.Center, right: TextHorizontalAlignment.Right };
const vertical = { baseline: TextVerticalAlignment.BaseLine, bottom: TextVerticalAlignment.Bottom, middle: TextVerticalAlignment.Middle, top: TextVerticalAlignment.Top };

class ClosedBoundaryPaths extends HatchBoundaryPaths {
  constructor(private readonly rings: readonly (readonly Point2D[])[]) {
    super();
  }

  override get length(): number {
    return this.rings.length;
  }

  override dxfy(tags: Dxfier): void {
    this.rings.forEach((ring, index) => {
      // The CAD writer uses outer hatch style (75 = 1). In that style
      // the holes must be Outermost paths to leave them unfilled.
      const kind = index === 0 ? PathTypeFlag.External : PathTypeFlag.Outermost;
      tags.push(92, kind | PathTypeFlag.Polyline);
      tags.push(72, 0);
      tags.push(73, 1);
      tags.push(93, ring.length);
      for (const { x, y } of ring) {
        tags.push(10, x);
        tags.push(20, y);
      }
      tags.push(97, 0);
    });
  }
}

// Legal CAD lineweights in hundredths of a millimetre.
const DXF_LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

function dxfLineweight(mm: number): number {
  const requested = Math.round(mm * 100);
  return DXF_LINEWEIGHTS.reduce((nearest, candidate) =>
    Math.abs(candidate - requested) < Math.abs(nearest - requested) ? candidate : nearest);
}

export interface DxfObjectStroke {
  color: string;
  lineWeight: number;
  dash?: readonly number[];
}

function entityColor(color: string) {
  return {
    colorNumber: cssToAci(color),
    trueColor: /^#[0-9a-f]{6}$/i.test(color) ? String(Number.parseInt(color.slice(1), 16)) : undefined,
  };
}

function writeObjectLineweight(entity: { dxfy(tags: Dxfier): void }, weight: number) {
  const write = entity.dxfy.bind(entity);
  entity.dxfy = (tags) => {
    const start = tags.lines.length;
    write(tags);
    for (let i = start; i < tags.lines.length; i += 2) {
      if (tags.lines[i] === 100 && tags.lines[i + 1] === 'AcDbEntity') {
        tags.lines.splice(i + 2, 0, 370, dxfLineweight(weight));
        break;
      }
    }
  };
}

/** R2007 document structure and entities, with the same layer naming as R12. */
export class ModernDxfWriter extends DxfWriter {
  private readonly cad = new CadWriter();
  private readonly linetypes = new Map<string, string>();
  private readonly styledLayers = new Map<string, string>();

  constructor(private readonly metadataComment?: string) {
    super();
    this.cad.setUnits(Units.Meters);
    this.cad.addLType('DASHED', 'Dashed line', [0.2, -0.1]);
  }

  override layer(name: string, cssColor: string, linetype: DxfLinetype = 'CONTINUOUS'): string {
    const safe = super.layer(name, cssColor, linetype);
    if (!this.cad.layer(safe)) this.cad.addLayer(safe, cssToAci(cssColor), linetype);
    return safe;
  }

  strokeLayer(name: string, color: string, weightMm: number, weightKey?: string): string {
    const weight = dxfLineweight(weightMm);
    const key = `${name}-${weightKey ?? weight}-${color.replace(/^#/, '')}`;
    const existing = this.styledLayers.get(key);
    if (existing) return existing;
    const layerName = this.layer(key, color);
    this.styledLayers.set(key, layerName);
    const layer = this.cad.layer(layerName);
    if (layer) {
      if (color !== '#000000' && /^#[0-9a-f]{6}$/i.test(color)) {
        layer.trueColor = Number.parseInt(color.slice(1), 16);
      }
      const writeLayer = layer.dxfy.bind(layer);
      layer.dxfy = (tags) => {
        const start = tags.lines.length;
        writeLayer(tags);
        // The library emits a hard-coded group 370 for layers.
        for (let i = start; i < tags.lines.length; i += 2) {
          if (tags.lines[i] === 370) tags.lines[i + 1] = weight;
        }
      };
    }
    return layerName;
  }

  private lineType(dash: readonly number[] = []): string {
    if (dash.length === 0) return 'CONTINUOUS';
    const key = dash.join(',');
    const existing = this.linetypes.get(key);
    if (existing) return existing;
    const name = `IFC-LINE-${this.linetypes.size + 1}`;
    this.cad.addLType(name, name, dash.map((length, index) => index % 2 ? -length : length));
    this.linetypes.set(key, name);
    return name;
  }

  override addPolyline(
    points: readonly Point2D[], layer: string, closed: boolean, colorOverride?: string, style?: DxfObjectStroke,
  ): void {
    if (points.length < 2) return;
    const entity = this.cad.addLWPolyline(points.map(({ x, y }) => ({ point: { x, y } })), {
      layerName: layer,
      flags: closed ? LWPolylineFlags.Closed : LWPolylineFlags.None,
      ...(style ? { ...entityColor(style.color), lineType: this.lineType(style.dash) }
        : { colorNumber: colorOverride === undefined ? undefined : cssToAci(colorOverride) }),
    });
    if (style) writeObjectLineweight(entity, style.lineWeight);
  }

  override addLine(start: Point2D, end: Point2D, layer: string, colorOverride?: string, style?: DxfObjectStroke): void {
    const entity = this.cad.addLine(toPoint3d(start), toPoint3d(end), {
      layerName: layer,
      ...(style ? { ...entityColor(style.color), lineType: this.lineType(style.dash) }
        : { colorNumber: colorOverride === undefined ? undefined : cssToAci(colorOverride) }),
    });
    if (style) writeObjectLineweight(entity, style.lineWeight);
  }

  override addText(
    position: Point2D,
    text: string,
    height: number,
    layer: string,
    options: { rotationDeg?: number; hAlign?: DxfTextHAlign; vAlign?: DxfTextVAlign; colorOverride?: string } = {},
  ): void {
    const clean = text.replace(/[\r\n\t]/g, ' ');
    if (!clean.trim() || !Number.isFinite(height) || height <= 0) return;
    const hAlign = options.hAlign ?? 'left';
    const vAlign = options.vAlign ?? 'baseline';
    const anchor = toPoint3d(position);
    this.cad.addText(anchor, height, clean, {
      layerName: layer,
      rotation: options.rotationDeg,
      horizontalAlignment: horizontal[hAlign],
      verticalAlignment: vertical[vAlign],
      secondAlignmentPoint: hAlign !== 'left' || vAlign !== 'baseline' ? anchor : undefined,
      colorNumber: options.colorOverride === undefined ? undefined : cssToAci(options.colorOverride),
    });
  }

  addHatch(
    outer: readonly Point2D[], holes: readonly (readonly Point2D[])[], layer: string,
    pattern: 'solid' | 'diagonal' | 'cross-hatch' = 'solid', spacing = 0, color?: string, lineWeight?: number,
  ): void {
    const valid = (ring: readonly Point2D[]) =>
      ring.length >= 3 && ring.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
    if (!valid(outer) || !holes.every(valid)) return;
    const paths = new ClosedBoundaryPaths([outer, ...holes]);
    const options = { layerName: layer, ...(color ? entityColor(color) : {}) };
    if (pattern === 'solid') {
      this.cad.addHatch(paths, { name: HatchPredefinedPatterns.SOLID }, options);
      return;
    }
    if (!Number.isFinite(spacing) || spacing <= 0) return;
    const diagonal = pattern === 'diagonal';
    // The library's ANSI patterns use a Y offset of 1.25 or 3.175 at 45°.
    // The perpendicular distance is the projection of that offset.
    const scale = spacing / ((diagonal ? 1.25 : 3.175) * Math.SQRT1_2);
    const entity = this.cad.addHatch(paths, {
      name: diagonal ? HatchPredefinedPatterns.ANSI31 : HatchPredefinedPatterns.ANSI38,
      scale,
    }, options);
    if (lineWeight !== undefined) writeObjectLineweight(entity, lineWeight);
  }

  override toString(): string {
    const comment = (this.metadataComment ?? 'ifc-lite section export - units: metres').replace(/[\r\n\t]/g, ' ');
    return '999\n' + comment + '\n' + this.cad.stringify();
  }
}
