/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** PDF export uses the fixed scale of the current view or active sheet. */

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { DrawingSheet } from '@ifc-lite/drawing-2d';
import { useTranslation } from '@/i18n';
import { DRAWING_OMISSION_LABEL_KEYS, type DrawingExportOmission } from '@/lib/export/drawing-export-omissions';

export interface DrawingPdfExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The view's publication scale (the "N" in "1:N"). */
  displayedScale: number;
  sheetEnabled: boolean;
  activeSheet: DrawingSheet | null;
  /** Content the selected PDF writer will leave out. */
  omissions?: readonly DrawingExportOmission[];
  /** `useDrawingExport`'s `handleExportPDF`, called exactly as the old prompt called it. */
  onExport: (scaleFactor?: number) => void;
}

export function DrawingPdfExportDialog({
  open, onOpenChange, displayedScale, sheetEnabled, activeSheet, omissions = [], onExport,
}: DrawingPdfExportDialogProps) {
  const { t } = useTranslation();
  const usesSheetScale = sheetEnabled && activeSheet !== null;
  const handleExport = () => {
    // Pass the view's published scale explicitly. A sheet already has its own
    // fixed scale and paper, which useDrawingExport reads directly.
    onExport(usesSheetScale ? undefined : displayedScale);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('section2d.pdf.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t(usesSheetScale ? 'section2d.pdf.dialogDescriptionSheet' : 'section2d.pdf.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('section2d.pdf.scaleLabel')}</Label>
            <p className="text-sm text-muted-foreground">
              {usesSheetScale
                ? t('section2d.pdf.sheetScaleLocked', { scale: activeSheet.scale.name })
                : `1:${displayedScale}`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>{t('section2d.pdf.paperLabel')}</Label>
            <p className="text-sm text-muted-foreground">
              {usesSheetScale
                ? t('section2d.pdf.paperSheet', {
                  name: activeSheet.paper.name,
                  width: Math.round(activeSheet.paper.widthMm),
                  height: Math.round(activeSheet.paper.heightMm),
                })
                : t('section2d.pdf.paperAuto')}
            </p>
          </div>
          {omissions.length > 0 && (
            <div role="note" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">{t('section2d.export.omission.pdfTitle')}</p>
              <ul className="mt-1 list-disc pl-5">
                {omissions.map((omission) => (
                  <li key={omission}>{t(DRAWING_OMISSION_LABEL_KEYS[omission])}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('section2d.pdf.cancel')}</Button>
          <Button onClick={handleExport}>{t('section2d.pdf.export')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
