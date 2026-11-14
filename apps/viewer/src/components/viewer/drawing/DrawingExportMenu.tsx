/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The Drawing header's one Export menu (#5494): SVG, DXF, PDF, Print, and
 *  saving the markup into the model. File exports need a drawing. The PDF
 *  item opens a real scale/paper dialog (#5496) instead of exporting at the
 *  on-screen scale directly — everything else in the menu stays one click. */

import { useState } from 'react';
import { ChevronDown, Download, FileDown, FileText, FolderDown, Printer, RefreshCw } from 'lucide-react';
import type { DrawingSheet } from '@ifc-lite/drawing-2d';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/i18n';
import { useDialogs } from '@/components/ui/confirm-dialog';
import { drawingExportOmissions, DRAWING_OMISSION_LABEL_KEYS, type DrawingExportContent } from '@/lib/export/drawing-export-omissions';
import { SaveMarkupToModelMenuItem } from '../SaveMarkupToModelButton';
import type { SavedSectionCut } from '@/store/savedSectionCutsStore';
import type { useSavedViewBatch } from '@/hooks/useSavedViewBatch';
import { DrawingPdfExportDialog } from './DrawingPdfExportDialog';

export interface DrawingExportMenuProps {
  hasDrawing: boolean;
  selected3D?: SavedSectionCut;
  batch?: ReturnType<typeof useSavedViewBatch>;
  /** Icon-only trigger for narrow hosts. */
  compact: boolean;
  onExportSvg: () => void;
  onExportDxf: () => void;
  /** `useDrawingExport`'s `handleExportPDF`; the dialog supplies the scale. */
  onExportPdf: (scaleFactor?: number) => void;
  onPrint: () => void;
  /** The drawing's current on-screen scale, offered as the PDF dialog's "As displayed". */
  displayedScale: number;
  sheetEnabled: boolean;
  activeSheet: DrawingSheet | null;
  markupCounts: DrawingExportContent['markupCounts'];
  visibleUnderlayCount: number;
  visibleRasterReferenceCount?: number;
}

export function DrawingExportMenu({
  batch, hasDrawing, selected3D, compact, onExportSvg, onExportDxf, onExportPdf, onPrint,
  displayedScale, sheetEnabled, activeSheet, markupCounts, visibleUnderlayCount, visibleRasterReferenceCount = 0,
}: DrawingExportMenuProps) {
  const { t } = useTranslation();
  const { confirmDialog } = useDialogs();
  const label = t('section2d.export.menu');
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const content: DrawingExportContent = {
    markupCounts,
    visibleUnderlayCount,
    visibleRasterReferenceCount,
    sheetScale: sheetEnabled && activeSheet ? activeSheet.scale.factor : null,
  };
  const pdfOmissions = drawingExportOmissions(content, 'pdf');

  const handleDxfExport = async () => {
    const omissions = drawingExportOmissions(content, 'dxf');
    if (omissions.length > 0) {
      const confirmed = await confirmDialog({
        title: t('section2d.export.omission.dxfTitle'),
        description: t('section2d.export.omission.dxfDescription', {
          items: omissions.map((omission) => t(DRAWING_OMISSION_LABEL_KEYS[omission])).join(', '),
        }),
        confirmLabel: t('section2d.export.omission.continue'),
      });
      if (!confirmed) return;
    }
    onExportDxf();
  };
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild disabled={batch?.busy}>
              {compact ? (
                <Button variant="ghost" size="icon-xs" aria-label={label}>
                  <Download className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" aria-label={label}>
                  <Download className="h-3.5 w-3.5" />
                  {label}
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              )}
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{batch?.busy ? t('section2d.export.batchBusy') : label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-56">
          {batch && <>
            <DropdownMenuItem disabled={!batch.available} onSelect={() => void batch.run('dxf')}>
              <FolderDown className="mr-2 h-4 w-4" />{t('section2d.export.allViews')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!batch.available} onSelect={() => void batch.run('pdf')}>
              <FileText className="mr-2 h-4 w-4" />{t('section2d.export.allViewsPdf')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!batch.available} onSelect={() => void batch.run('svg')}>
              <Download className="mr-2 h-4 w-4" />{t('section2d.export.allViewsSvg')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!batch.canRefresh} onSelect={() => void batch.run()}>
              <RefreshCw className="mr-2 h-4 w-4" />{t('section2d.export.refreshAllViews')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>}
          {selected3D ? (['svg', 'dxf', 'pdf'] as const).map(format => (
            <DropdownMenuItem key={format} disabled={!selected3D.viewpoint || !batch}
              onSelect={() => void batch?.export3D(selected3D, format)}>
              <FileDown className="mr-2 h-4 w-4" />{t(`section2d.export.${format}`)}
            </DropdownMenuItem>
          )) : <>
            <DropdownMenuItem onClick={onExportSvg} disabled={!hasDrawing}>
              <Download className="mr-2 h-4 w-4" />{t('section2d.export.svg')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { void handleDxfExport(); }} disabled={!hasDrawing}>
              <FileDown className="mr-2 h-4 w-4" />{t('section2d.export.dxf')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPdfDialogOpen(true)} disabled={!hasDrawing}>
              <FileText className="mr-2 h-4 w-4" />{t('section2d.export.pdf')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPrint} disabled={!hasDrawing}>
              <Printer className="mr-2 h-4 w-4" />{t('section2d.export.print')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <SaveMarkupToModelMenuItem />
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!batch?.progress}>
        <DialogContent hideCloseButton onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t('section2d.export.batchBusy')}</DialogTitle>
            {batch?.progress && <DialogDescription role="status">
              {t('section2d.export.batchProgress', batch.progress)}
            </DialogDescription>}
          </DialogHeader>
        </DialogContent>
      </Dialog>
      {!selected3D && <DrawingPdfExportDialog
        open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}
        displayedScale={displayedScale} sheetEnabled={sheetEnabled} activeSheet={activeSheet}
        omissions={pdfOmissions}
        onExport={onExportPdf}
      />}
    </>
  );
}
