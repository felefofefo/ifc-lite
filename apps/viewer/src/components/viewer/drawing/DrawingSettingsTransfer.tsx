/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';
import { downloadFile } from '@/lib/export/download';

export function DrawingSettingsTransfer({ filename, getData, onImport }: {
  filename: string;
  getData: () => unknown;
  onImport: (raw: string) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  return <div className="flex flex-wrap items-center gap-2">
    <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
      <Upload className="h-3.5 w-3.5" />{t('drawingUnderlay.template.import')}
    </Button>
    <Button type="button" size="sm" variant="outline" onClick={() => {
      try {
        downloadFile(JSON.stringify(getData(), null, 2), filename, 'application/json');
        setFailed(false);
      } catch (error) {
        console.warn('Could not export drawing settings', error);
        setFailed(true);
      }
    }}>
      <Download className="h-3.5 w-3.5" />{t('drawingUnderlay.settings.transferExport')}
    </Button>
    <input hidden type="file" accept=".json,application/json" ref={input} onChange={async event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      try {
        if (file.size > 2_000_000) throw new Error('Drawing settings file too large.');
        onImport(await file.text());
        setFailed(false);
      } catch (error) {
        console.warn('Could not import drawing settings', error);
        setFailed(true);
      }
    }} />
    {failed && <p role="alert" className="w-full text-sm text-destructive">{t('drawingUnderlay.settings.transferError')}</p>}
  </div>;
}
