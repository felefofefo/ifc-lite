/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useTranslation } from '@/i18n';
import { Input } from '@/components/ui/input';
import { DEFAULT_DISTANT, type DistantElements } from '@/lib/drawing/distant-elements';

export function DistantElementsSettings({ value, onChange }: {
  value?: DistantElements; onChange: (value?: DistantElements) => void;
}) {
  const { t } = useTranslation();
  return <fieldset className="space-y-2 border-t pt-2">
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked ? { ...DEFAULT_DISTANT } : undefined)} />
      {t('section2d.distant.label')}
    </label>
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
      <label className="flex items-center justify-between gap-2">{t('section2d.distant.weight')}
        <Input className="h-7 w-20" type="number" min="0.05" max="2.11" step="any" value={value.weight ?? ''}
          onChange={e => { if (e.target.validity.valid) onChange({ ...value, weight: e.target.value ? e.target.valueAsNumber : undefined }); }} />
      </label>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!value.color}
          onChange={e => onChange({ ...value, color: e.target.checked ? '#999999' : undefined })} />{t('section2d.distant.color')}</label>
        {value.color && <input type="color" aria-label={t('section2d.distant.color')} value={value.color}
          onChange={e => onChange({ ...value, color: e.target.value })} />}
      </div>
    </>}
  </fieldset>;
}
