/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { installLayout } from '@/test/dom-layout.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphicOverrideEngine, type Drawing2D } from '@ifc-lite/drawing-2d';
import type { TextAnnotation2D } from '@/store/slices/drawing2DSlice';
import { Drawing2DCanvas } from './Drawing2DCanvas.js';
import { TextAnnotationEditor } from './TextAnnotationEditor.js';
import { textAnnotationScreenSize } from '@/lib/drawing/annotation-types';

installLayout();

const DRAWING: Drawing2D = {
  config: { plane: { axis: 'y', position: 0, flipped: false }, projectionDepth: 10, includeHiddenLines: true, creaseAngle: 30, scale: 100 },
  lines: [], cutPolygons: [], projectionPolygons: [],
  bounds: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
  stats: { cutLineCount: 0, projectionLineCount: 0, hiddenLineCount: 0, silhouetteLineCount: 0, polygonCount: 0, totalTriangles: 0, processingTimeMs: 0 },
};

type Rect = { x: number; y: number; width: number; height: number };

function renderNote(scale: number, appearance?: TextAnnotation2D['appearance']) {
  const fills: Array<Rect & { color: string }> = [];
  const strokes: Array<Rect & { color: string }> = [];
  const texts: Array<{ text: string; font: string; align: string }> = [];
  const values = new Map<string | symbol, unknown>();
  const context = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'canvas') return { width: 800, height: 600 };
      if (prop === 'measureText') return (text: string) => {
        const font = String(values.get('font') ?? '');
        const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 0);
        return { width: text.length * size / 2 };
      };
      if (prop === 'fillRect') return (x: number, y: number, width: number, height: number) => {
        fills.push({ x, y, width, height, color: String(values.get('fillStyle')) });
      };
      if (prop === 'strokeRect') return (x: number, y: number, width: number, height: number) => {
        strokes.push({ x, y, width, height, color: String(values.get('strokeStyle')) });
      };
      if (prop === 'fillText') return (text: string) => {
        texts.push({ text, font: String(values.get('font')), align: String(values.get('textAlign')) });
      };
      if (values.has(prop)) return values.get(prop);
      return () => undefined;
    },
    set(_target, prop, value) { values.set(prop, value); return true; },
  }) as unknown as CanvasRenderingContext2D;

  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = ((kind: string) => kind === '2d' ? context : null) as typeof original;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const note: TextAnnotation2D = {
    id: 'note', text: 'Note', position: { x: 1, y: 2 },
    fontSize: 14, color: '#111111', backgroundColor: '#ffeecc', borderColor: '#445566', appearance,
  };
  try {
    act(() => root.render(<Drawing2DCanvas
      drawing={DRAWING} transform={{ x: 0, y: 0, scale }} sectionAxis="down"
      showHiddenLines={false} overrideEngine={new GraphicOverrideEngine()}
      overridesEnabled={false} entityColorMap={new Map()} useIfcMaterials={false}
      publicationScale={100} textAnnotations={[note]}
      selectedAnnotation={{ type: 'text', id: note.id }}
    />));
    return { fills, strokes, texts };
  } finally {
    act(() => root.unmount());
    container.remove();
    HTMLCanvasElement.prototype.getContext = original;
  }
}

describe('Drawing2DCanvas text selection bounds', () => {
  it('matches the rendered styled text at different zoom levels', () => {
    const appearance = { textHeight: 2, bold: true, italic: true, font: 'serif' as const, align: 'right' as const };
    for (const scale of [20, 100]) {
      const { fills, strokes, texts } = renderNote(scale, appearance);
      const background = fills.find(fill => fill.color === '#ffeecc');
      const selection = strokes.find(stroke => stroke.color === '#1976D2');
      assert.ok(background, 'the styled text must draw its background');
      assert.ok(selection, 'a selected note must draw a selection rectangle');
      assert.equal(background.x, scale);
      assert.equal(background.y, scale * 2);
      assert.equal(selection.x, background.x - 4);
      assert.equal(selection.y, background.y - 4);
      assert.equal(selection.width, background.width + 8);
      assert.equal(selection.height, background.height + 8);
      assert.deepEqual(texts.find(item => item.text === 'Note'), {
        text: 'Note', font: 'italic bold 11.2px serif', align: 'right',
      });
    }
  });

  it('keeps the default pixel-sized text and its selection in sync', () => {
    const { fills, strokes, texts } = renderNote(100);
    const background = fills.find(fill => fill.color === '#ffeecc');
    const selection = strokes.find(stroke => stroke.color === '#1976D2');
    assert.ok(background);
    assert.ok(selection);
    assert.equal(selection.width, background.width + 8);
    assert.equal(selection.height, background.height + 8);
    assert.equal(texts.find(item => item.text === 'Note')?.font, '14px system-ui, sans-serif');
  });

  it('edits a styled note at the same font size at every zoom', () => {
    const annotation: TextAnnotation2D = {
      id: 'styled', text: 'Hello', position: { x: 0, y: 0 },
      fontSize: 14, color: '#111111', backgroundColor: '#ffffff', borderColor: '#333333',
      appearance: { textHeight: 2, font: 'serif' },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      const fontSize = textAnnotationScreenSize(annotation, 10);
      assert.equal(fontSize, 11.2);
      act(() => root.render(<TextAnnotationEditor annotation={annotation}
        screenX={0} screenY={0} fontSize={fontSize} onConfirm={() => {}} onCancel={() => {}} />));
      const textarea = container.querySelector('textarea');
      assert.ok(textarea);
      assert.equal(textarea.style.fontSize, '11.2px');
      assert.equal(textarea.style.fontFamily, 'serif');
      assert.equal(textAnnotationScreenSize(annotation, 50), 11.2);
      assert.equal(textAnnotationScreenSize({ ...annotation, appearance: undefined }, 50), 14);
      for (const align of ['left', 'center', 'right']) {
        assert.ok(container.querySelector(`button[aria-label="Align ${align}"] svg`), `${align} uses a real icon`);
      }
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
