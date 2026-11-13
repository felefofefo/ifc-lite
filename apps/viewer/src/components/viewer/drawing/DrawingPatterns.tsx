/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';
import { useDrawingPatterns } from '@/hooks/useDrawingPatterns';
import { parsePat } from '@/lib/drawing/pattern-library';

export function DrawingPatterns() {
  const { t } = useTranslation();
  const { patterns, save } = useDrawingPatterns();
  const [failed, setFailed] = useState(false);
  return <div className="space-y-2">
    <h3 className="font-medium">{t('section2d.patterns.title')}</h3>
    <p className="text-muted-foreground">{t('section2d.patterns.builtin')}</p>
    <label className="block">{t('section2d.patterns.import')}
      <input type="file" accept=".pat" className="block w-full" onChange={async e => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (!file) return;
        try {
          if (file.size > 256_000) throw new Error('PAT size limit.');
          const next = new Map(patterns.map(p => [p.id, p]));
          for (const p of parsePat(await file.text())) next.set(p.id, p);
          save([...next.values()]); setFailed(false);
        } catch { setFailed(true); }
      }} />
    </label>
    {patterns.map(pattern => <div key={pattern.id} className="flex items-center justify-between gap-2">
      <span className="truncate">{pattern.name}</span>
      <Button size="sm" variant="ghost" onClick={() => {
        try { save(patterns.filter(p => p.id !== pattern.id)); setFailed(false); } catch { setFailed(true); }
      }}>{t('section2d.patterns.remove')}</Button>
    </div>)}
    {failed && <p role="alert" className="text-destructive">{t('section2d.patterns.error')}</p>}
  </div>;
}
