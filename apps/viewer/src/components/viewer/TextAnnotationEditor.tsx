/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Inline text editor overlay for text annotations on the 2D drawing.
 * Positioned absolutely over the canvas at the annotation's screen coordinates.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import type { TextAnnotation2D } from '@/store/slices/drawing2DSlice';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { textAnnotationLayout, textBoxStyle, textLeaderGeometry, textLeaderStyle } from '@/lib/drawing/annotation-types';
import type { resolveTextLeaderArrow } from '@/lib/drawing/drawing-tag-library';
import { TextLeaderGraphic } from './drawing/TextLeaderGraphic';
import type { LineweightRow } from '@/lib/drawing/lineweight-table';

interface TextAnnotationEditorProps {
  /** The text annotation being edited */
  annotation: TextAnnotation2D;
  /** Screen position (top-left of the editor) */
  screenX: number;
  screenY: number;
  /** Font size in screen pixels, consistent with the drawing canvas. */
  fontSize?: number;
  lineweights?: LineweightRow;
  leaderTip?: { x: number; y: number };
  leaderArrow?: ReturnType<typeof resolveTextLeaderArrow>;
  /** Called with the new text when user confirms (Enter) */
  onConfirm: (id: string, text: string, format?: Pick<TextAnnotation2D, 'bold' | 'italic' | 'align' | 'widthMm'>) => void;
  /** Called when user cancels (Escape) or submits empty text */
  onCancel: (id: string) => void;
}

export function TextAnnotationEditor({
  annotation,
  screenX,
  screenY,
  fontSize,
  lineweights,
  leaderTip, leaderArrow,
  onConfirm,
  onCancel,
}: TextAnnotationEditorProps): React.ReactElement {
  const { t } = useTranslation();

  const [bold, setBold] = useState(annotation.bold ?? annotation.appearance?.bold ?? false);
  const [italic, setItalic] = useState(annotation.italic ?? annotation.appearance?.italic ?? false);
  const [align, setAlign] = useState<'left'|'center'|'right'>(annotation.align ?? annotation.appearance?.align ?? 'left');
  const [text, setText] = useState(annotation.text);
  const [widthMm, setWidthMm] = useState(annotation.widthMm);
  const widthDrag = useRef<{ pointerId: number; x: number; width: number; initial: number | undefined } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Match the same paper-space layout used to paint the final annotation.
  const paperUnit = fontSize === undefined ? 0 : fontSize / (annotation.appearance?.textHeight ?? 2.5);
  const measureContext = useMemo(() => typeof document === 'undefined' ? null
    : document.createElement('canvas').getContext('2d'), []);
  const layout = textAnnotationLayout({ ...annotation, text, bold, italic, widthMm }, paperUnit,
    (line, font) => {
      if (!measureContext) return undefined;
      measureContext.font = font;
      return measureContext.measureText(line).width;
    });
  const textColor = annotation.appearance?.color ?? annotation.color;
  const box = textBoxStyle(annotation, lineweights);
  const leader = leaderTip && textLeaderGeometry({ x: 0, y: 0, width: layout.bgW, height: layout.bgH },
    { x: leaderTip.x - screenX, y: leaderTip.y - screenY }, paperUnit);
  // Guard against blur firing during the initial click that created this editor.
  // Without this, the mouseup from the placement click can steal focus from the
  // textarea before the user has a chance to type, causing an immediate cancel.
  const readyRef = useRef(false);

  // Auto-focus on mount, but defer slightly so the originating mouseup
  // from the placement click doesn't immediately steal focus / trigger blur.
  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      textareaRef.current?.focus();
      // Mark ready after focus is established so blur handler is enabled
      readyRef.current = true;
    });
    return () => cancelAnimationFrame(timer);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = text.trim();
      if (trimmed) {
        onConfirm(annotation.id, trimmed, {
          bold: bold === (annotation.appearance?.bold ?? false) ? undefined : bold,
          italic: italic === (annotation.appearance?.italic ?? false) ? undefined : italic,
          align: align === (annotation.appearance?.align ?? 'left') ? undefined : align,
          widthMm,
        });
      } else {
        onCancel(annotation.id);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel(annotation.id);
    }
    // Stop propagation so the canvas doesn't receive these events
    e.stopPropagation();
  }, [text, annotation.id, annotation.appearance, onConfirm, onCancel, bold, italic, align, widthMm]);

  const handleBlur = useCallback(() => {
    // Ignore blur events that fire before the editor is fully ready
    // (e.g. from the originating click's mouseup stealing focus)
    if (!readyRef.current) return;

    const trimmed = text.trim();
    if (trimmed) {
      onConfirm(annotation.id, trimmed, {
          bold: bold === (annotation.appearance?.bold ?? false) ? undefined : bold,
          italic: italic === (annotation.appearance?.italic ?? false) ? undefined : italic,
          align: align === (annotation.appearance?.align ?? 'left') ? undefined : align,
          widthMm,
        });
    } else {
      onCancel(annotation.id);
    }
  }, [text, annotation.id, annotation.appearance, onConfirm, onCancel, bold, italic, align, widthMm]);

  return (
    // The wrapper only stops canvas click placement; the textarea and buttons own keyboard interaction.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="absolute z-20 pointer-events-auto"
      style={{
        left: screenX,
        top: screenY,
      }}
      // Prevent mousedown from propagating to canvas (which would place another annotation)
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onBlur={e => {
        if (!widthDrag.current && !e.currentTarget.contains(e.relatedTarget)) handleBlur();
      }}
    >
       <div className="absolute bottom-full left-0 mb-1 flex w-max items-center gap-1 rounded border bg-popover p-1 text-xs shadow-sm"
         role="toolbar" aria-label="Text formatting" onMouseDown={event => event.preventDefault()}>
         <button type="button" title="Bold" aria-pressed={bold} className={bold ? 'rounded bg-accent px-2 py-1 font-bold' : 'rounded px-2 py-1 font-bold'}
           onClick={() => setBold(value => !value)}>B</button>
         <button type="button" title="Italic" aria-pressed={italic} className={italic ? 'rounded bg-accent px-2 py-1 italic' : 'rounded px-2 py-1 italic'}
           onClick={() => setItalic(value => !value)}>I</button>
         {(['left','center','right'] as const).map(value => {
           const Icon = value === 'left' ? AlignLeft : value === 'center' ? AlignCenter : AlignRight;
           return <button key={value} type="button" aria-label={`Align ${value}`}
             aria-pressed={align === value} title={`Align ${value}`}
             className={align === value ? 'rounded bg-accent p-1.5' : 'rounded p-1.5'}
             onClick={() => setAlign(value)}><Icon aria-hidden="true" className="size-4" /></button>;
         })}
         {widthMm !== undefined && <Button type="button" size="sm" variant="ghost" title="Automatic width"
           onClick={() => setWidthMm(undefined)}>Auto</Button>}
         <Button type="button" size="sm" className="shrink-0" disabled={!text.trim()}
           onClick={handleBlur}>{t('section2d.tags.apply')}</Button>
       </div>
      {leader && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <TextLeaderGraphic geometry={leader} pen={textLeaderStyle(annotation.appearance, lineweights)} unit={paperUnit} arrow={leaderArrow} />
      </svg>}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('textAnnotationEditor.placeholder')}
        aria-label={t('textAnnotationEditor.inputLabel')}
        className="relative block box-border resize-none overflow-hidden border-0 outline outline-1 outline-offset-2 outline-primary"
        wrap={widthMm === undefined ? 'off' : 'soft'}
        rows={1}
        style={{
          width: widthMm === undefined ? Math.max(text ? 1 : 80, layout.bgW + 1) : layout.bgW,
          whiteSpace: widthMm === undefined ? 'pre' : 'pre-wrap',
          overflowWrap: widthMm === undefined ? 'normal' : 'anywhere',
          height: Math.max(1, layout.bgH),
          padding: layout.padding,
          font: layout.font,
          lineHeight: `${layout.lineHeight}px`,
          textAlign: align,
          backgroundColor: box.background ?? 'transparent',
          color: textColor,
          caretColor: textColor,
        }}
      />
      {box.border && paperUnit > 0 && <svg aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <rect x={0} y={0} width="100%" height="100%" fill="none" stroke={box.border.color}
          strokeWidth={box.border.weight * paperUnit}
          strokeDasharray={box.border.dash.map(value => value * paperUnit).join(' ') || undefined} />
      </svg>}
      {paperUnit > 0 && <button type="button" aria-label="Resize text width"
        title="Resize text width" className="absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-primary bg-background cursor-ew-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          widthDrag.current = { pointerId: event.pointerId, x: event.clientX,
            width: (textareaRef.current?.getBoundingClientRect().width ?? layout.bgW) / paperUnit,
            initial: widthMm };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const drag = widthDrag.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.stopPropagation();
          setWidthMm(Math.max(6, Math.min(1000, drag.width + (event.clientX - drag.x) / paperUnit)));
        }}
        onPointerUp={event => {
          if (widthDrag.current?.pointerId !== event.pointerId) return;
          event.stopPropagation();
          widthDrag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          textareaRef.current?.focus();
        }}
        onPointerCancel={event => {
          if (widthDrag.current?.pointerId !== event.pointerId) return;
          setWidthMm(widthDrag.current.initial); widthDrag.current = null;
          textareaRef.current?.focus();
        }}
        onLostPointerCapture={() => {
          if (widthDrag.current) { setWidthMm(widthDrag.current.initial); widthDrag.current = null; }
        }}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault(); event.stopPropagation();
          const delta = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 5 : 1);
          setWidthMm(value => Math.max(6, Math.min(1000, (value ?? layout.bgW / paperUnit) + delta)));
        }} />}
      <div className="absolute left-0 top-full mt-1 w-max text-2xs text-muted-foreground bg-popover/80 px-1 rounded">
        {t('textAnnotationEditor.hint')}
      </div>
    </div>
  );
}
