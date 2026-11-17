/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const MAX_TAG_SVG_SIZE = 128 * 1024;
const SVG_NS = 'http://www.w3.org/2000/svg';
const allowed = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'stop',
]);
const fieldPattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

function parseSvg(source: string) {
  if (source.length > MAX_TAG_SVG_SIZE || /<!DOCTYPE/i.test(source)) throw new Error('Invalid SVG');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const svg = document.documentElement;
  if (svg.namespaceURI !== SVG_NS || svg.localName !== 'svg') throw new Error('Invalid SVG');
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    if (element.namespaceURI !== SVG_NS || !allowed.has(element.localName)) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const value = attribute.value.trim();
      const localReference = /^#[\w:.-]+$/.test(value);
      const externalUrl = /url\s*\(/i.test(value.replace(/url\(\s*['"]?#[\w:.-]+['"]?\s*\)/gi, ''));
      if (/^on/i.test(attribute.localName) || attribute.localName === 'base' ||
          (attribute.localName === 'href' && !localReference) ||
          externalUrl || (attribute.localName === 'style' && /[\\@]/.test(value))) {
        element.removeAttributeNode(attribute);
      }
    }
  }
  return svg;
}

function textNodes(svg: Element) {
  return Array.from(svg.querySelectorAll('text, tspan, textPath'))
    .flatMap(element => Array.from(element.childNodes).filter(node => node.nodeType === 3));
}

export function tagSvgFields(source: string): string[] {
  const svg = parseSvg(source);
  return [...new Set(textNodes(svg).flatMap(node =>
    Array.from((node.textContent ?? '').matchAll(fieldPattern), match => match[1].trim()).filter(Boolean)))];
}

export function readTagSvg(source: string, requireFields = true): string {
  const svg = parseSvg(source);
  if (requireFields && !textNodes(svg).some(node => [...(node.textContent ?? '').matchAll(fieldPattern)].length)) {
    throw new Error('The SVG has no tag fields');
  }
  const result = new XMLSerializer().serializeToString(svg);
  if (result.length > MAX_TAG_SVG_SIZE) throw new Error('SVG is too large');
  return result;
}

// The circle is a registration point in the author's artwork, not a visible mark.
function readAnchor(svg: Element): { x: number; y: number } | undefined {
  const markers = svg.querySelectorAll('[id="tag-anchor"]');
  const marker = markers[0];
  let point: { x: number; y: number } | undefined;
  if (marker?.localName === 'circle') {
    point = { x: Number(marker.getAttribute('cx') ?? 0), y: Number(marker.getAttribute('cy') ?? 0) };
    for (let element: Element | null = marker; element && element !== svg; element = element.parentElement) {
      const transforms = (element as SVGGraphicsElement).transform?.baseVal;
      if (!transforms) continue;
      for (let i = transforms.numberOfItems - 1; i >= 0; i--) {
        const { a, b, c, d, e, f } = transforms.getItem(i).matrix;
        point = { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
      }
    }
  }
  markers.forEach(element => element.remove());
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined;
}

function anchorOnPaper(
  point: { x: number; y: number } | undefined,
  viewBox: number[] | undefined,
  width: number, height: number, aspectRatio: string,
) {
  if (!point) return { x: width / 2, y: height / 2 };
  if (!viewBox) return { x: point.x * 25.4 / 96, y: point.y * 25.4 / 96 };

  const [x, y, w, h] = viewBox;
  const [align, fit] = aspectRatio.replace(/^defer\s+/, '').split(/\s+/);
  if (align === 'none') return { x: (point.x - x) * width / w, y: (point.y - y) * height / h };
  const scale = fit === 'slice' ? Math.max(width / w, height / h) : Math.min(width / w, height / h);
  const ax = align.includes('xMin') ? 0 : align.includes('xMax') ? 1 : 0.5;
  const ay = align.includes('YMin') ? 0 : align.includes('YMax') ? 1 : 0.5;
  return { x: (point.x - x) * scale + (width - w * scale) * ax,
    y: (point.y - y) * scale + (height - h * scale) * ay };
}

function rotateDirection(
  svg: Element, group: Element, angle: number, pivot: { x: number; y: number },
  scaleX: number, scaleY: number,
) {
  // Conjugate the paper-space rotation into the parent group's coordinates.
  let basis = new DOMMatrix();
  for (let element = group.parentElement; element && element !== svg; element = element.parentElement) {
    const list = (element as SVGGraphicsElement).transform?.baseVal;
    if (!list) continue;
    let matrix = new DOMMatrix();
    for (let i = 0; i < list.numberOfItems; i++) matrix = matrix.multiply(list.getItem(i).matrix);
    basis = matrix.multiply(basis);
  }
  basis = new DOMMatrix().scale(scaleX, scaleY).multiply(basis);
  const transform = basis.inverse().translate(pivot.x, pivot.y).rotate(angle).translate(-pivot.x, -pivot.y).multiply(basis);
  const values = [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f];
  if (!values.every(Number.isFinite)) return;
  const wrapper = svg.ownerDocument.createElementNS(SVG_NS, 'g');
  wrapper.setAttribute('transform', `matrix(${values.join(' ')})`);
  group.before(wrapper);
  wrapper.append(group);
}

export function renderTagSvg(source: string, values: ReadonlyMap<string, string>, directionAngle?: number) {
  const svg = parseSvg(source);
  const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const ratio = viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0
    ? viewBox[3] / viewBox[2] : undefined;
  const size = (attribute: 'width' | 'height') => {
    const match = svg.getAttribute(attribute)?.trim().match(/^(\d+(?:\.\d+)?|\.\d+)(px|mm|cm|in|pt)?$/i);
    if (!match) return undefined;
    const factors: Record<string, number> = { px: 25.4 / 96, mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 };
    const mm = Number(match[1]) * factors[match[2]?.toLowerCase() ?? 'px'];
    return Number.isFinite(mm) && mm > 0 ? mm : undefined;
  };
  const explicitHeight = size('height');
  const width = size('width') ?? (explicitHeight && ratio ? explicitHeight / ratio : 20);
  const height = explicitHeight ?? width * (ratio ?? 0.5);
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Invalid SVG dimensions');
  const aspect = svg.getAttribute('preserveAspectRatio')?.trim() || 'xMidYMid meet';
  const box = ratio ? viewBox : undefined;
  const anchor = anchorOnPaper(readAnchor(svg), box, width, height, aspect);
  const direction = directionAngle === undefined ? null : svg.querySelector('g[id="marker-direction"]');
  if (direction && directionAngle !== undefined && Number.isFinite(directionAngle)) {
    const zero = anchorOnPaper({ x: 0, y: 0 }, box, width, height, aspect);
    const one = anchorOnPaper({ x: 1, y: 1 }, box, width, height, aspect);
    // Dynamic SVGs are authored with the arrow pointing up (negative SVG Y).
    rotateDirection(svg, direction, directionAngle + 90,
      { x: anchor.x - zero.x, y: anchor.y - zero.y }, one.x - zero.x, one.y - zero.y);
  }
  const text: string[] = [];
  for (const node of textNodes(svg)) {
    node.textContent = (node.textContent ?? '').replace(fieldPattern, (_, field: string) => {
      const value = values.get(field.trim()) ?? '—';
      text.push(value);
      return value;
    });
  }
  svg.setAttribute('width', String(width * 96 / 25.4));
  svg.setAttribute('height', String(height * 96 / 25.4));
  return {
    width, height, anchor, directional: !!direction, text: text.join(' / '),
    href: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)),
  };
}
