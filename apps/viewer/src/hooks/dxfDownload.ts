/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// R2007 uses UTF-8. Legacy R12 exports declare ANSI_1252 and need matching bytes.
import { downloadFile } from '@/lib/export/download';
import { toast } from '@/components/ui/toast';
import { encodeDxfCp1252 } from '@ifc-lite/drawing-2d';

export function downloadDxf(dxf: string, filename: string, encoding: 'windows-1252' | 'utf-8' = 'windows-1252'): void {
  if (encoding === 'utf-8') {
    downloadFile(dxf, filename, 'application/dxf');
    return;
  }
  const { bytes, hadUnmappable } = encodeDxfCp1252(dxf);
  if (hadUnmappable) {
    toast.info('Some characters have no DXF R12 text encoding and were exported as "?".');
  }
  downloadFile(bytes, filename, 'application/dxf');
}
