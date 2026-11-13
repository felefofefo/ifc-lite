/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/i18n';
import { isViewCodeAvailable } from '@/lib/drawing/view-markers';
import { useSavedSectionCuts } from '@/store/savedSectionCutsStore';

export function ViewIdentityDialog({ name: initialName, code: initialCode, id, close, save }: {
  name: string; code: string; id?: string; close: () => void; save: (name: string, code: string) => void;
}) {
  const { t } = useTranslation();
  const cuts = useSavedSectionCuts(s => s.cuts);
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [failed, setFailed] = useState(false);
  const valid = isViewCodeAvailable(code, cuts, id);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{t('section2d.views.identity')}</DialogTitle></DialogHeader>
      <form className="space-y-3" onSubmit={e => {
        e.preventDefault();
        if (!valid || !name.trim()) return;
        try { save(name.trim(), code.trim()); close(); } catch { setFailed(true); }
      }}>
        <label className="block space-y-1 text-sm">{t('section2d.views.name')}
          <Input value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">{t('section2d.views.code')}
          <Input value={code} maxLength={24} onChange={e => setCode(e.target.value)} />
        </label>
        {!valid && <p className="text-sm text-destructive">{t('section2d.views.codeConflict')}</p>}
        {failed && <p role="alert" className="text-sm text-destructive">{t('section2d.views.saveError')}</p>}
        <DialogFooter><Button type="submit" disabled={!valid || !name.trim()}>{t('section2d.views.save')}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
