/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { sketchCurve } from './sketch-input.js';
import { hitTestAnnotations } from '@/hooks/annotation2DHitTest';
import { drawingAnnotationDxf } from '@/lib/export/drawing-annotation-dxf';
import { expandDrawingAnnotationBounds } from '@/lib/export/drawing-annotation-pdf';
const circle = { id: 'curve', ...sketchCurve('circle', [{x:0,y:0}], {x:2,y:0})! };
const pick = (x:number,y:number) => hitTestAnnotations({screenX:x,screenY:y,threshold:10,drawingToScreen:p=>({x:p.x*100,y:p.y*100}),polys:[circle],texts:[],clouds:[],measures:[]});
it('circle is picked by curved edge, not its diameter or interior',()=>{assert.equal(pick(0,0),null);assert.deepEqual(pick(0,200),{type:'polygon',id:'curve'});});
it('DXF annotation carries exact bulges and a sampled fallback',()=>{const layer=drawingAnnotationDxf([circle],[],[],100).polylineLayers[0];assert.deepEqual(layer.curveVertices?.map(v=>v.bulge),[1,1]);assert.ok(layer.polylines[0].length>2);});
it('PDF extent accounts for the curved parts',()=>{const bounds=expandDrawingAnnotationBounds({min:{x:0,y:0},max:{x:0,y:0}},[circle],[],[],100);assert.ok(bounds.max.y>1.99&&bounds.min.y< -1.99);});
