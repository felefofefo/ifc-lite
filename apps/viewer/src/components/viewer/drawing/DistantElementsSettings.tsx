/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useTranslation } from '@/i18n';
import { DrawingSettingSwitch } from './DrawingSettingSwitch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LINEWEIGHT_PRESETS } from '@/lib/drawing/lineweight-table';
import { DEFAULT_DISTANT, type DistantElements } from '@/lib/drawing/distant-elements';

export function DistantElementsSettings({ value, onChange }: {
  value?: DistantElements; onChange: (value?: DistantElements) => void;
}) {
  const { t } = useTranslation();
  return <fieldset className="space-y-2 border-t pt-2">
    <DrawingSettingSwitch label={t('section2d.distant.label')} checked={!!value}
      onCheckedChange={enabled => onChange(enabled ? { ...DEFAULT_DISTANT } : undefined)} />
    {value && <>
      <label className="flex items-center justify-between gap-2">{t('section2d.distant.offset')}
        <Input className="h-7 w-20" type="number" min="0.01" step="any" value={value.offset}
          onChange={e => { if (e.target.valueAsNumber > 0) onChange({ ...value, offset: e.target.valueAsNumber }); }} />
      </label>
      <label className="flex items-center justify-between gap-2">{t('section2d.distant.fade')}
        <input type="range" min="0" max="1" step="0.05" value={value.fade}
          onChange={e => onChange({ ...value, fade: e.target.valueAsNumber })} />
        <output>{Math.round(value.fade * 100)}%</output>
      </label>
      <div className="flex items-center justify-between gap-2">
        <span>{t('section2d.distant.weight')}</span>
        <Select value={value.weight && LINEWEIGHT_PRESETS.includes(value.weight) ? value.weight : 'inherit'}
          onValueChange={weight => onChange({ ...value, weight: LINEWEIGHT_PRESETS.find(preset => preset === weight) })}>
          <SelectTrigger className="h-7 w-32" aria-label={t('section2d.distant.weight')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">{t('section2d.distant.inheritWeight')}</SelectItem>
            {LINEWEIGHT_PRESETS.map(preset => (
              <SelectItem key={preset} value={preset}>{t(`drawingUnderlay.lineweights.preset.${preset}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <DrawingSettingSwitch label={t('section2d.distant.color')} checked={!!value.color}
            onCheckedChange={enabled => onChange({ ...value, color: enabled ? '#999999' : undefined })} />
        </div>
        {value.color && <input type="color" aria-label={t('section2d.distant.color')} value={value.color}
          onChange={e => onChange({ ...value, color: e.target.value })} />}
      </div>
    </>}
  </fieldset>;
}
