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
import { textAnnotationLayout } from '@/lib/drawing/annotation-types';

interface TextAnnotationEditorProps {
  /** The text annotation being edited */
  annotation: TextAnnotation2D;
  /** Screen position (top-left of the editor) */
  screenX: number;
  screenY: number;
  /** Font size in screen pixels, consistent with the drawing canvas. */
  fontSize?: number;
  /** Called with the new text when user confirms (Enter) */
  onConfirm: (id: string, text: string, format?: Pick<TextAnnotation2D, 'bold' | 'italic' | 'align'>) => void;
  /** Called when user cancels (Escape) or submits empty text */
  onCancel: (id: string) => void;
}

export function TextAnnotationEditor({
  annotation,
  screenX,
  screenY,
  fontSize,
  onConfirm,
  onCancel,
}: TextAnnotationEditorProps): React.ReactElement {
  const { t } = useTranslation();

  const [bold, setBold] = useState(annotation.bold ?? annotation.appearance?.bold ?? false);
  const [italic, setItalic] = useState(annotation.italic ?? annotation.appearance?.italic ?? false);
  const [align, setAlign] = useState<'left'|'center'|'right'>(annotation.align ?? annotation.appearance?.align ?? 'left');
  const [text, setText] = useState(annotation.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Match the same paper-space layout used to paint the final annotation.
  const paperUnit = fontSize === undefined ? 0 : fontSize / (annotation.appearance?.textHeight ?? 2.5);
  const measureContext = useMemo(() => typeof document === 'undefined' ? null
    : document.createElement('canvas').getContext('2d'), []);
  const layout = textAnnotationLayout({ ...annotation, text, bold, italic }, paperUnit,
    (line, font) => {
      if (!measureContext) return undefined;
      measureContext.font = font;
      return measureContext.measureText(line).width;
    });
  const textColor = annotation.appearance?.color ?? annotation.color;
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
  }, [text, annotation.id, onConfirm, onCancel, bold, italic, align]);

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
        });
    } else {
      onCancel(annotation.id);
    }
  }, [text, annotation.id, onConfirm, onCancel, bold, italic, align]);

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
       </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={t('textAnnotationEditor.placeholder')}
        aria-label={t('textAnnotationEditor.inputLabel')}
        className="block box-border resize-none overflow-hidden border-0 outline outline-1 outline-primary"
        wrap="off"
        rows={1}
        style={{
          width: Math.max(text ? 1 : 80, layout.bgW + 1),
          height: Math.max(1, layout.bgH),
          padding: layout.padding,
          font: layout.font,
          lineHeight: `${layout.lineHeight}px`,
          textAlign: align,
          backgroundColor: annotation.backgroundColor,
          color: textColor,
          caretColor: textColor,
        }}
      />
      <div className="absolute left-0 top-full mt-1 w-max text-2xs text-muted-foreground bg-popover/80 px-1 rounded">
        {t('textAnnotationEditor.hint')}
      </div>
    </div>
  );
}
