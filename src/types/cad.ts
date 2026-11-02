/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ToolMode = 
  | 'select' 
  | 'pan' 
  | 'polyline' 
  | 'line' 
  | 'polygon' 
  | 'point' 
  | 'measure' 
  | 'text' 
  | 'erase';

export interface Point2D {
  x: number; // World CAD X (usually Easting in CAD coordinates, meters)
  y: number; // World CAD Y (usually Northing in CAD coordinates, meters)
  z?: number;
}

export interface CADPoint extends Point2D {
  id: string;
  name: string;
  code?: string;
  layerId: string;
  isSurveyNode?: boolean; // Originating from CSV survey data
}

export interface CADLine {
  id: string;
  start: Point2D;
  end: Point2D;
  layerId: string;
  color?: string;
  name?: string;
}

export interface CADPolyline {
  id: string;
  points: Point2D[];
  isClosed?: boolean;
  layerId: string;
  color?: string;
  name?: string;
}

export interface CADPolygon {
  id: string;
  points: Point2D[];
  layerId: string;
  color?: string;
  name?: string;
  fillOpacity?: number;
}

export interface CADText {
  id: string;
  x: number;
  y: number;
  text: string;
  height: number;
  rotation?: number;
  layerId: string;
  color?: string;
}

export interface CADLayer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  lineWidth: number;
  isSurveyPointsLayer?: boolean;
}

export type SnapType = 'node' | 'endpoint' | 'midpoint' | 'intersection' | 'nearest';

export interface SnapPoint {
  point: Point2D;
  type: SnapType;
  sourceId?: string;
  label: string;
}

export interface CoordinateSystem {
  code: string;
  name: string;
  description: string;
  proj4Def: string;
  wktPrj: string;
  isTM: boolean;
}

export interface ProjectState {
  version: string;
  name: string;
  crs: string; // e.g. "EPSG:5186"
  isSwappedXY: boolean;
  layers: CADLayer[];
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  texts: CADText[];
}

export interface HistoryStep {
  layers: CADLayer[];
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  texts: CADText[];
  description: string;
}
