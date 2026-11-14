/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * DrawingSettingsPanel - Full control over 2D drawing graphic styles
 *
 * Provides:
 * - IFC class and type view templates
 * - Custom rule editor
 * - Color, line weight, hatch controls
 */

import React, { useCallback, useState, useMemo } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, GripVertical, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import { LINE_WEIGHT_VALUES } from '@ifc-lite/drawing-2d';
import { type LineweightRow } from '@/lib/drawing/lineweight-table';
import { DrawingViewTemplates } from './drawing/DrawingViewTemplates';
import { loadSavedFilters, encodeSavedFilter, decodeSavedFilter } from '@/lib/search/saved-filters';
import { DrawingPenControls } from './drawing/DrawingPenControls';
import { DrawingRulePaintControls } from './drawing/DrawingHatchSelect';
import type { GraphicOverrideRule, GraphicStyle } from '@ifc-lite/drawing-2d';

// Common IFC types for the dropdown
const COMMON_IFC_TYPES = [
  'IfcWall',
  'IfcWallStandardCase',
  'IfcSlab',
  'IfcColumn',
  'IfcBeam',
  'IfcDoor',
  'IfcWindow',
  'IfcStair',
  'IfcRoof',
  'IfcRailing',
  'IfcCovering',
  'IfcFurnishingElement',
  'IfcSpace',
  'IfcBuildingElementProxy',
];

export function DrawingSettingsPanel({ lineweights = LINE_WEIGHT_VALUES }: { lineweights?: LineweightRow } = {}) {
  const { t } = useTranslation();
  const customOverrideRules = useViewerStore((s) => s.customOverrideRules);
  const addCustomRule = useViewerStore((s) => s.addCustomRule);
  const updateCustomRule = useViewerStore((s) => s.updateCustomRule);
  const removeCustomRule = useViewerStore((s) => s.removeCustomRule);

  // Expanded sections
  const [customRulesOpen, setCustomRulesOpen] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  // Add new custom rule
  const handleAddRule = useCallback(() => {
    const newRule: GraphicOverrideRule = {
      id: `custom-${Date.now()}`,
      name: 'New Rule',
      enabled: true,
      priority: customOverrideRules.length + 100, // Start after presets
      criteria: {
        type: 'ifcType',
        ifcTypes: ['IfcWall'],
        includeSubtypes: true,
      },
      style: {},
    };
    addCustomRule(newRule);
    setEditingRuleId(newRule.id);
  }, [customOverrideRules.length, addCustomRule]);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b bg-muted/50 px-4 py-2">
        <DrawingViewTemplates lineweights={lineweights} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Custom Rules Section */}
        <Collapsible open={customRulesOpen} onOpenChange={setCustomRulesOpen}>
          <div className="border-t">
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors">
                <span className="text-sm font-medium">{t('drawingUnderlay.settings.customRulesHeading')}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t('drawingUnderlay.settings.customRulesCount', { count: customOverrideRules.length })}
                  </span>
                  {customRulesOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 space-y-2">
                {customOverrideRules.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    {t('drawingUnderlay.settings.noCustomRules')}
                  </div>
                ) : (
                  customOverrideRules.map((rule) => (
                    <CustomRuleItem
                      key={rule.id}
                      rule={rule}
                      lineweights={lineweights}
                      isEditing={editingRuleId === rule.id}
                      onEdit={() => setEditingRuleId(rule.id)}
                      onSave={() => setEditingRuleId(null)}
                      onUpdate={(updates) => updateCustomRule(rule.id, updates)}
                      onRemove={() => removeCustomRule(rule.id)}
                    />
                  ))
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleAddRule}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('drawingUnderlay.settings.addCustomRuleButton')}
                </Button>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>
    </div>
  );
}

// Editable custom rule
interface CustomRuleItemProps {
  rule: GraphicOverrideRule;
  lineweights: LineweightRow;
  isEditing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onUpdate: (updates: Partial<GraphicOverrideRule>) => void;
  onRemove: () => void;
}

function CustomRuleItem({
  rule,
  lineweights,
  isEditing,
  onEdit,
  onSave,
  onUpdate,
  onRemove,
}: CustomRuleItemProps) {
  const { t } = useTranslation();
  const savedFilter = decodeSavedFilter(rule.savedFilter);
  const filters = loadSavedFilters();
  const ifcTypes = useMemo(() => {
    if ('ifcTypes' in rule.criteria && rule.criteria.ifcTypes) {
      return rule.criteria.ifcTypes;
    }
    return [];
  }, [rule.criteria]);

  const handleIfcTypeChange = useCallback(
    (type: string) => {
      onUpdate({
        criteria: {
          type: 'ifcType',
          ifcTypes: [type],
          includeSubtypes: true,
        },
      });
    },
    [onUpdate]
  );

  const handleStyleChange = useCallback(
    (key: keyof GraphicStyle, value: string | number | undefined) => {
      onUpdate({
        style: {
          ...rule.style,
          [key]: value,
        },
      });
    },
    [rule.style, onUpdate]
  );

  if (!isEditing) {
    return (
      <div
        className="group flex items-center gap-2 px-2 py-1.5 bg-muted/30 rounded text-xs hover:bg-muted/50"
      >
        <button type="button" className="flex flex-1 min-w-0 items-center gap-2 text-left" onClick={onEdit}>
          <GripVertical className="h-3 w-3 text-muted-foreground" />
          {rule.style.fillColor && (
            <span className="w-4 h-4 rounded border border-foreground/20" style={{ backgroundColor: rule.style.fillColor }} />
          )}
          <span className="flex-1 min-w-0">
            <span className="block font-medium truncate">{rule.name}</span>
            <span className="block text-muted-foreground truncate">
              {ifcTypes.join(', ') || t('drawingUnderlay.settings.clickToEditPlaceholder')}
            </span>
          </span>
        </button>
        <IconButton
          label={t(rule.enabled ? 'drawingUnderlay.settings.disableRule' : 'drawingUnderlay.settings.enableRule', { name: rule.name })}
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onUpdate({ enabled: !rule.enabled });
          }}
        >
          {rule.enabled ? (
            <Eye className="h-3 w-3" />
          ) : (
            <EyeOff className="h-3 w-3 text-muted-foreground" />
          )}
        </IconButton>
      </div>
    );
  }

  return (
    <div className="p-3 bg-muted/30 rounded-lg border space-y-3">
      {/* Name */}
      <div>
        <Label className="text-xs">{t('drawingUnderlay.settings.ruleNameLabel')}</Label>
        <Input
          aria-label={t('drawingUnderlay.settings.ruleNameLabel')}
          value={rule.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="h-8 text-sm mt-1"
        />
      </div>

      <div>
        <Label className="text-xs">{t('drawingUnderlay.template.filter')}</Label>
        <Select value={savedFilter ? `filter:${savedFilter.name}` : 'class'} onValueChange={(value) => {
          const filter = filters.find(preset => `filter:${preset.name}` === value);
          onUpdate({ savedFilter: filter ? encodeSavedFilter(filter) : undefined });
        }}>
          <SelectTrigger aria-label={t('drawingUnderlay.template.filter')} className="mt-1 h-8 min-w-0 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="max-w-[min(26rem,85vw)]">
            <SelectItem value="class">{t('drawingUnderlay.template.classRule')}</SelectItem>
            {savedFilter && !filters.some(filter => filter.name === savedFilter.name) &&
              <SelectItem value={`filter:${savedFilter.name}`}>{savedFilter.name}</SelectItem>}
            {filters.map(filter => <SelectItem key={filter.name} value={`filter:${filter.name}`}>{filter.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {/* IFC Class */}
      <div>
        <Label className="text-xs">{t('drawingUnderlay.settings.ifcClassLabel')}</Label>
        <Select
          disabled={!!savedFilter}
          value={ifcTypes[0] || ''}
          onValueChange={handleIfcTypeChange}
        >
          <SelectTrigger className="h-8 text-sm mt-1" aria-label={t('drawingUnderlay.settings.ifcClassLabel')}>
            <SelectValue placeholder={t('drawingUnderlay.settings.selectClassPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {COMMON_IFC_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Colors */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">{t('drawingUnderlay.settings.fillColorLabel')}</Label>
          <div className="flex gap-1 mt-1">
            <input
              type="color"
              aria-label={t('drawingUnderlay.settings.fillColorPickerLabel')}
              value={rule.style.fillColor || '#808080'}
              onChange={(e) => handleStyleChange('fillColor', e.target.value)}
              className="w-8 h-8 rounded border cursor-pointer"
            />
            <Input
              aria-label={t('drawingUnderlay.settings.fillColorHexLabel')}
              value={rule.style.fillColor ?? ''} placeholder="#808080"
              onChange={(e) => handleStyleChange('fillColor', e.target.value || undefined)}
              className="h-8 text-xs font-mono flex-1"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">{t('drawingUnderlay.settings.strokeColorLabel')}</Label>
          <div className="flex gap-1 mt-1">
            <input
              type="color"
              aria-label={t('drawingUnderlay.settings.strokeColorPickerLabel')}
              value={rule.style.strokeColor || '#000000'}
              onChange={(e) => handleStyleChange('strokeColor', e.target.value)}
              className="w-8 h-8 rounded border cursor-pointer"
            />
            <Input
              aria-label={t('drawingUnderlay.settings.strokeColorHexLabel')}
              value={rule.style.strokeColor ?? ''} placeholder="#000000"
              onChange={(e) => handleStyleChange('strokeColor', e.target.value || undefined)}
              className="h-8 text-xs font-mono flex-1"
            />
          </div>
        </div>
      </div>

      <DrawingRulePaintControls style={rule.style} onChange={(style) => onUpdate({ style })} />

      <DrawingPenControls style={rule.style} lineweights={lineweights} onChange={(style) => onUpdate({ style })} />

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          {t('drawingUnderlay.settings.deleteButton')}
        </Button>
        <Button size="sm" onClick={onSave}>
          {t('drawingUnderlay.settings.doneButton')}
        </Button>
      </div>
    </div>
  );
}
