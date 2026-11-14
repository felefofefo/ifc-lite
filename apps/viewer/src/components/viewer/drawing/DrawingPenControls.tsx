/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { GraphicStyle, LineStylePreset, LineWeightPreset } from '@ifc-lite/drawing-2d';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { LINEWEIGHT_PRESETS, type LineweightRow } from '@/lib/drawing/lineweight-table';

export function DrawingPenControls({ style, lineweights, onChange }: {
  style: GraphicStyle; lineweights: LineweightRow; onChange: (style: GraphicStyle) => void;
}) {
  const { t } = useTranslation();
  return <div className="space-y-3">{(['cut', 'surface'] as const).map(role => {
    const weightKey = role === 'cut' ? 'lineWeight' : 'projectionLineWeight';
    const typeKey = role === 'cut' ? 'lineStyle' : 'projectionLineStyle';
    const hatchKey = role === 'cut' ? 'hatchLineWeight' : 'surfaceHatchLineWeight';
    const weight = style[weightKey], type = style[typeKey];
    return <fieldset key={role} className="space-y-2">
      <legend className="mb-1 text-xs font-medium">{t(role === 'cut' ? 'drawingUnderlay.pen.cut' : 'drawingUnderlay.pen.projection')}</legend>
      <div className="flex gap-1">
        <Select value={typeof weight === 'number' ? 'custom' : weight ?? 'inherit'} onValueChange={value => onChange({
          ...style, [weightKey]: value === 'inherit' ? undefined : value === 'custom' ? 0.35 : value as LineWeightPreset,
        })}>
          <SelectTrigger className="h-8 flex-1" aria-label={t('drawingUnderlay.settings.lineWeightLabel')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">{t('drawingUnderlay.pen.inherit')}</SelectItem>
            {LINEWEIGHT_PRESETS.map(preset => <SelectItem value={preset} key={preset}>
              {t('drawingUnderlay.lineweights.resolvedPreset', { preset: t(`drawingUnderlay.lineweights.preset.${preset}`), width: lineweights[preset] })}
            </SelectItem>)}
            <SelectItem value="custom">{t('drawingUnderlay.settings.customLineWeightOption')}</SelectItem>
          </SelectContent>
        </Select>
        {typeof weight === 'number' && <Input className="h-8 w-20" type="number" min="0.05" max="2.11" step="0.01"
          aria-label={t('drawingUnderlay.settings.customLineWeightInputLabel')} value={weight}
          onChange={e => { if (e.target.validity.valid && e.target.value) onChange({ ...style, [weightKey]: e.target.valueAsNumber }); }} />}
      </div>
      <Select value={typeof type === 'string' ? type : type ? 'custom' : 'inherit'} onValueChange={value => onChange({
        ...style, [typeKey]: value === 'inherit' ? undefined : value as LineStylePreset,
      })}>
        <SelectTrigger className="h-8 w-full" aria-label={t('drawingUnderlay.materials.lineType')}><SelectValue /></SelectTrigger>
        <SelectContent>
          {(['inherit', 'solid', 'dashed', 'dotted', 'dashdot', 'center'] as const).map(kind => <SelectItem key={kind} value={kind}>{t(`drawingUnderlay.materials.lineType.${kind}`)}</SelectItem>)}
          {type && typeof type !== 'string' && <SelectItem value="custom" disabled>{t('drawingUnderlay.settings.customLineWeightOption')}</SelectItem>}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-xs">{t('drawingUnderlay.pen.hatch')}
        <Input className="h-8 w-20" type="number" min="0.05" max="2.11" step="0.01" value={style[hatchKey] ?? ''}
          placeholder={t('drawingUnderlay.pen.inherit')}
          onChange={e => { if (e.target.validity.valid) onChange({ ...style, [hatchKey]: e.target.value ? e.target.valueAsNumber : undefined }); }} />
      </label>
    </fieldset>;
  })}</div>;
}
