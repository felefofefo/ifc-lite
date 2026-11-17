/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { GraphicStyle, LineStylePreset } from '@ifc-lite/drawing-2d';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n';
import { LINEWEIGHT_PRESETS, type LineweightRow } from '@/lib/drawing/lineweight-table';

export function DrawingPenControls({ style, onChange }: {
  style: GraphicStyle; lineweights: LineweightRow; onChange: (style: GraphicStyle) => void;
}) {
  const { t } = useTranslation();
  return <div className="space-y-3">{(['cut', 'surface'] as const).map(role => {
    const weightKey = role === 'cut' ? 'lineWeight' : 'projectionLineWeight';
    const typeKey = role === 'cut' ? 'lineStyle' : 'projectionLineStyle';
    const hatchKey = role === 'cut' ? 'hatchLineWeight' : 'surfaceHatchLineWeight';
    const type = style[typeKey];
    return <fieldset key={role} className="space-y-2">
      <legend className="mb-1 text-xs font-medium">{t(role === 'cut' ? 'drawingUnderlay.pen.cut' : 'drawingUnderlay.pen.projection')}</legend>
      <PenWeightSelect value={style[weightKey]} label={t('drawingUnderlay.settings.lineWeightLabel')}
        onChange={weight => onChange({ ...style, [weightKey]: weight })} />
      <Select value={typeof type === 'string' ? type : type ? 'custom' : 'inherit'} onValueChange={value => onChange({
        ...style, [typeKey]: value === 'inherit' ? undefined : value as LineStylePreset,
      })}>
        <SelectTrigger className="h-8 w-full" aria-label={t('drawingUnderlay.materials.lineType')}><SelectValue /></SelectTrigger>
        <SelectContent>
          {(['inherit', 'solid', 'dashed', 'dotted', 'dashdot', 'center'] as const).map(kind => <SelectItem key={kind} value={kind}>{t(`drawingUnderlay.materials.lineType.${kind}`)}</SelectItem>)}
          {type && typeof type !== 'string' && <SelectItem value="custom" disabled>{t('drawingUnderlay.settings.customLineWeightOption')}</SelectItem>}
        </SelectContent>
      </Select>
      <PenWeightSelect value={style[hatchKey]} label={t('drawingUnderlay.pen.hatch')}
        onChange={weight => onChange({ ...style, [hatchKey]: weight })} />
    </fieldset>;
  })}</div>;
}


function PenWeightSelect({ value, label, onChange }: {
  value: GraphicStyle['lineWeight']; label: string; onChange: (weight: typeof LINEWEIGHT_PRESETS[number] | undefined) => void;
}) {
  const { t } = useTranslation();
  return <div className="space-y-1">
    <span className="text-xs">{label}</span>
    <Select value={typeof value === 'number' ? 'legacy' : value ?? 'inherit'}
      onValueChange={next => onChange(LINEWEIGHT_PRESETS.find(preset => preset === next))}>
      <SelectTrigger className="h-8 w-full" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit">{t('drawingUnderlay.pen.inherit')}</SelectItem>
        {LINEWEIGHT_PRESETS.map(preset => <SelectItem key={preset} value={preset}>
          {t(`drawingUnderlay.lineweights.preset.${preset}`)}
        </SelectItem>)}
        {typeof value === 'number' && <SelectItem value="legacy" disabled>{t('drawingUnderlay.pen.legacyWeight')}</SelectItem>}
      </SelectContent>
    </Select>
  </div>;
}
