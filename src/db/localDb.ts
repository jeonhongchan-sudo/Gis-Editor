import Dexie, { type EntityTable } from 'dexie';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, AttributeTemplate } from '../types/cad';

interface LocalProject {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export class CADDatabase extends Dexie {
  projects!: EntityTable<LocalProject, 'id'>;
  layers!: EntityTable<CADLayer & { projectId: number }, 'id'>;
  points!: EntityTable<CADPoint & { projectId: number }, 'id'>;
  lines!: EntityTable<CADLine & { projectId: number }, 'id'>;
  polylines!: EntityTable<CADPolyline & { projectId: number }, 'id'>;
  polygons!: EntityTable<CADPolygon & { projectId: number }, 'id'>;
  texts!: EntityTable<CADText & { projectId: number }, 'id'>;
  attributeTemplates!: EntityTable<AttributeTemplate, 'id'>;

  constructor() {
    super('CADDatabase');
    this.version(2).stores({
      projects: '++id, name, createdAt, updatedAt',
      layers: '++id, projectId, name',
      points: '++id, projectId, layerId',
      lines: '++id, projectId, layerId',
      polylines: '++id, projectId, layerId',
      polygons: '++id, projectId, layerId',
      texts: '++id, projectId, layerId',
      attributeTemplates: '++id, name, createdAt'
    });
  }
}

export const db = new CADDatabase();
