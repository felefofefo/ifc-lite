/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { GraphicStyle, LineStylePreset } from '@ifc-lite/drawing-2d';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { backgroundHatchPattern, hasHatchPaint, isMaterialHatchPattern, MATERIAL_HATCH_PATTERNS, type MaterialHatchPattern, type FillPaint } from '@/lib/drawing/material-hatches';

import { useDrawingPatterns } from '@/hooks/useDrawingPatterns';

const samples = {
  solid: 'bg-muted-foreground',
  diagonal: 'bg-[repeating-linear-gradient(45deg,transparent_0_4px,currentColor_4px_5px)]',
  'cross-hatch': 'bg-[repeating-linear-gradient(45deg,transparent_0_4px,currentColor_4px_5px),repeating-linear-gradient(-45deg,transparent_0_4px,currentColor_4px_5px)]',
  none: '',
};

export function DrawingHatchSelect({ label, value, background, onChange }: {
  background?: boolean;
  label: string;
  value: MaterialHatchPattern | undefined;
  onChange: (value: MaterialHatchPattern | undefined) => void;
}) {
  const { t } = useTranslation();
  const { patterns: imported } = useDrawingPatterns();
  const selected = background ? backgroundHatchPattern(value) : value;
  const patterns = background ? (['solid', 'none'] as const) : MATERIAL_HATCH_PATTERNS;
  return (
    <Select value={selected ?? 'default'} onValueChange={(next) => onChange(background ? backgroundHatchPattern(next) : isMaterialHatchPattern(next) ? next : undefined)}>
      <SelectTrigger aria-label={label} className="h-8 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="default">{t('drawingUnderlay.materials.hatch.default')}</SelectItem>
        {patterns.map((pattern) => (
          <SelectItem key={pattern} value={pattern}>
            <span className="flex items-center gap-2">
              <span aria-hidden className={`h-3 w-5 rounded-sm border text-muted-foreground ${samples[pattern]}`} />
              {t(`drawingUnderlay.materials.hatch.${pattern}`)}
            </span>
          </SelectItem>
        ))}
        {!background && imported.map(pattern => <SelectItem key={pattern.id} value={pattern.id}>{pattern.name}</SelectItem>)}
        {!background && selected?.startsWith('pat:') && !imported.some(p => p.id === selected) &&
          <SelectItem value={selected} disabled>{selected.slice(4)}</SelectItem>}
      </SelectContent>
    </Select>
  );
}

export function DrawingFillControl({ label, paint, background, onChange }: {
  background?: boolean;
  label: string;
  paint?: FillPaint;
  onChange: (paint: FillPaint) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex min-w-0 items-center gap-1">
        <DrawingHatchSelect background={background} label={label} value={paint?.pattern} onChange={(pattern) => onChange(pattern ? { ...paint, pattern } : {})} />
        <Input className="h-8 w-9 shrink-0 cursor-pointer p-1" type="color"
          value={/^#[0-9a-f]{6}$/i.test(paint?.color ?? '') ? paint!.color : '#666666'}
          aria-label={t('drawingUnderlay.materials.fillColor', { label })}
          onChange={(event) => onChange({ ...paint, color: event.target.value })} />
        <Button type="button" size="icon-xs" variant="ghost" disabled={!paint?.color && !paint?.pattern}
          aria-label={t('drawingUnderlay.materials.resetPaint', { label })}
          onClick={() => onChange({})}><RotateCcw className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

export function DrawingRulePaintControls({ style, onChange }: { style: GraphicStyle; onChange: (style: GraphicStyle) => void }) {
  const { t } = useTranslation();
  return <>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium">{t('drawingUnderlay.materials.cut')}</legend>
        {(['background', 'foreground'] as const).map((side) => {
          const patternKey = side === 'background' ? 'hatchBackgroundPattern' : 'hatchPattern';
          const colorKey = side === 'background' ? 'backgroundColor' : 'hatchColor';
          const pattern = side === 'foreground' ? style.publicationPattern ?? style[patternKey] : style[patternKey];
          return <DrawingFillControl key={side} background={side === 'background'} label={t(`drawingUnderlay.materials.${side}`)}
            paint={{ pattern: isMaterialHatchPattern(pattern) ? pattern : undefined, color: style[colorKey] }}
            onChange={(paint) => {
              const pattern = paint.pattern;
              const imported = pattern && pattern !== 'solid' && pattern !== 'none' && pattern !== 'diagonal' && pattern !== 'cross-hatch';
              onChange({ ...style, [patternKey]: imported ? undefined : pattern, [colorKey]: paint.color,
                publicationPattern: side === 'foreground' ? imported ? pattern : undefined : style.publicationPattern });
            }} />;
        })}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium">{t('drawingUnderlay.materials.surface')}</legend>
        {(['background', 'foreground'] as const).map((side) => (
          <DrawingFillControl key={side} background={side === 'background'}
            label={t(`drawingUnderlay.materials.${side}`)} paint={style.surfaceHatch?.[side]}
            onChange={(paint) => {
              const next = { ...style.surfaceHatch };
              if (side === 'background') next.background = { ...paint, pattern: backgroundHatchPattern(paint.pattern) };
              else next.foreground = paint;
              onChange({ ...style, surfaceHatch: hasHatchPaint(next) ? next : undefined });
            }} />
        ))}
      </fieldset>
      <Select value={typeof style.lineStyle === 'string' ? style.lineStyle : 'inherit'}
        onValueChange={(value) => onChange({ ...style, lineStyle: value === 'inherit' ? undefined : value as LineStylePreset })}>
        <SelectTrigger aria-label={t('drawingUnderlay.materials.lineType')} className="h-8 text-xs">
          <SelectValue placeholder={t('drawingUnderlay.materials.lineType')} />
        </SelectTrigger>
        <SelectContent>{(['inherit', 'solid', 'dashed', 'dotted', 'dashdot', 'center'] as const).map((kind) =>
          <SelectItem key={kind} value={kind}>{t(`drawingUnderlay.materials.lineType.${kind}`)}</SelectItem>
        )}</SelectContent>
      </Select>
  </>;
}
