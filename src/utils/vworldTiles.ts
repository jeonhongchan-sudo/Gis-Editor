/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import proj4, { type Converter } from 'proj4';
import { Point2D } from '../types/cad';
import './projections';

export const VWORLD_API_KEY = 'F5BF837F-5852-437A-9913-E50588F45AD5';

export type VWorldMapLayer = 'off' | 'Base' | 'Satellite';

export interface VWorldOverlayConfig {
  layer: VWorldMapLayer;
  opacity: number;
  sourceCrs: string;
}

interface TileLayerSpec {
  id: Exclude<VWorldMapLayer, 'off'>;
  label: string;
  shortLabel: string;
  ext: 'png' | 'jpeg';
  minZoom: number;
  maxZoom: number;
}

export const VWORLD_LAYERS: TileLayerSpec[] = [
  { id: 'Base', label: '일반지도', shortLabel: '일반', ext: 'png', minZoom: 6, maxZoom: 19 },
  { id: 'Satellite', label: '위성영상', shortLabel: '위성', ext: 'jpeg', minZoom: 6, maxZoom: 19 }
];

const ORIGIN_SHIFT = 20037508.342789244; // Math.PI * 6378137
const EARTH_CIRCUMFERENCE = ORIGIN_SHIFT * 2;
const TILE_SIZE = 256;
const MAX_CACHE_TILES = 360;
const ERROR_RETRY_MS = 15000;

// Cached proj4 converters per TM CRS
const converterCache = new Map<string, Converter>();

function getWgs84Converter(sourceCrs: string): Converter {
  const key = sourceCrs && sourceCrs !== 'LOCAL' ? sourceCrs : 'EPSG:5186';
  let conv = converterCache.get(key);
  if (!conv) {
    conv = proj4(key, 'EPSG:4326');
    converterCache.set(key, conv);
  }
  return conv;
}

export function lonLatToMercator(lon: number, lat: number): Point2D {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = (lon * ORIGIN_SHIFT) / 180;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y = (Math.log((1 + sinLat) / (1 - sinLat)) / 2) * (ORIGIN_SHIFT / Math.PI);
  return { x, y };
}

export function mercatorToLonLat(mx: number, my: number): { lon: number; lat: number } {
  const lon = (mx / ORIGIN_SHIFT) * 180;
  let lat = (my / ORIGIN_SHIFT) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return { lon, lat };
}

export function worldToLonLat(x: number, y: number, sourceCrs: string): { lon: number; lat: number } | null {
  try {
    const conv = getWgs84Converter(sourceCrs);
    const [lon, lat] = conv.forward([x, y]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { lon, lat };
  } catch {
    return null;
  }
}

export function lonLatToWorld(lon: number, lat: number, sourceCrs: string): Point2D | null {
  try {
    const conv = getWgs84Converter(sourceCrs);
    const [x, y] = conv.inverse([lon, lat]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

export function worldToMercator(x: number, y: number, sourceCrs: string): Point2D | null {
  const ll = worldToLonLat(x, y, sourceCrs);
  if (!ll) return null;
  return lonLatToMercator(ll.lon, ll.lat);
}

export function mercatorToWorld(mx: number, my: number, sourceCrs: string): Point2D | null {
  try {
    const { lon, lat } = mercatorToLonLat(mx, my);
    const conv = getWgs84Converter(sourceCrs);
    const [x, y] = conv.inverse([lon, lat]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

export function getDefaultKoreaCenterWorld(sourceCrs: string): Point2D {
  // Seoul City Hall area as default anchor when opening map on an empty canvas
  try {
    const conv = getWgs84Converter(sourceCrs);
    const [x, y] = conv.inverse([126.978, 37.5665]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  } catch {
    // fallback below
  }
  return { x: 198055, y: 551880 };
}

interface TileCacheEntry {
  status: 'loading' | 'loaded' | 'error';
  img?: HTMLImageElement;
  lastUsed: number;
  errorAt?: number;
}

class VWorldTileCache {
  private entries = new Map<string, TileCacheEntry>();

  private makeKey(layer: string, z: number, x: number, y: number): string {
    return `${layer}/${z}/${y}/${x}`;
  }

  private evictIfNeeded() {
    if (this.entries.size <= MAX_CACHE_TILES) return;
    const sorted = Array.from(this.entries.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const removeCount = this.entries.size - Math.floor(MAX_CACHE_TILES * 0.8);
    for (let i = 0; i < removeCount; i++) {
      this.entries.delete(sorted[i][0]);
    }
  }

  getOrFetch(
    layer: 'Base' | 'Satellite',
    ext: 'png' | 'jpeg',
    z: number,
    x: number,
    y: number,
    onLoad: () => void,
    onError: () => void
  ): TileCacheEntry {
    const key = this.makeKey(layer, z, x, y);
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing) {
      existing.lastUsed = now;
      if (existing.status === 'error' && existing.errorAt && now - existing.errorAt > ERROR_RETRY_MS) {
        this.entries.delete(key);
      } else {
        return existing;
      }
    }

    const entry: TileCacheEntry = { status: 'loading', lastUsed: now };
    this.entries.set(key, entry);
    this.evictIfNeeded();

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        entry.status = 'loaded';
        entry.img = img;
        entry.lastUsed = Date.now();
        onLoad();
      } else {
        entry.status = 'error';
        entry.errorAt = Date.now();
        onError();
      }
    };
    img.onerror = () => {
      entry.status = 'error';
      entry.errorAt = Date.now();
      onError();
    };
    img.src = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_API_KEY}/${layer}/${z}/${y}/${x}.${ext}`;

    return entry;
  }

  findParentLoadedTile(
    layer: string,
    z: number,
    tx: number,
    ty: number,
    minZoom: number
  ): { img: HTMLImageElement; sx: number; sy: number; size: number } | null {
    for (let delta = 1; delta <= 3; delta++) {
      const pz = z - delta;
      if (pz < minZoom) break;
      const scale = 1 << delta;
      const ptx = tx >> delta;
      const pty = ty >> delta;
      const key = this.makeKey(layer, pz, ptx, pty);
      const entry = this.entries.get(key);
      if (entry && entry.status === 'loaded' && entry.img) {
        entry.lastUsed = Date.now();
        const subSize = TILE_SIZE / scale;
        const sx = (tx & (scale - 1)) * subSize;
        const sy = (ty & (scale - 1)) * subSize;
        return { img: entry.img, sx, sy, size: subSize };
      }
    }
    return null;
  }
}

export const vworldTileCache = new VWorldTileCache();

export interface VWorldRenderStats {
  zoomLevel: number;
  tileCount: number;
  loadedCount: number;
  loadingCount: number;
  errorCount: number;
}

export interface VWorldMapSnapshot {
  panX: number;
  panY: number;
  zoom: number;
  width: number;
  height: number;
  dpr: number;
  layer: VWorldMapLayer;
  sourceCrs: string;
  tileRenderTick: number;
  quality: 'low' | 'high';
  stats: VWorldRenderStats;
}

export function drawVWorldOverlay(params: {
  ctx: CanvasRenderingContext2D;
  offscreenCanvas: HTMLCanvasElement;
  snapshotRef: { current: VWorldMapSnapshot | null };
  width: number;
  height: number;
  dpr: number;
  view: { panX: number; panY: number; zoom: number };
  config: VWorldOverlayConfig;
  tileRenderTick: number;
  isInteracting: boolean;
  onTileLoaded: () => void;
  onTileError: () => void;
}): VWorldRenderStats | null {
  const {
    ctx,
    offscreenCanvas,
    snapshotRef,
    width,
    height,
    dpr,
    view,
    config,
    tileRenderTick,
    isInteracting,
    onTileLoaded,
    onTileError
  } = params;

  if (config.layer === 'off' || width <= 0 || height <= 0 || view.zoom <= 0) {
    snapshotRef.current = null;
    return null;
  }

  const clampedOpacity = Math.max(0.1, Math.min(1, config.opacity));
  const snap = snapshotRef.current;
  const sameSurface =
    snap !== null &&
    snap.layer === config.layer &&
    snap.sourceCrs === config.sourceCrs &&
    snap.width === width &&
    snap.height === height &&
    snap.dpr === dpr;

  // 1. Exact Cache Hit: skip tile reprojection & re-compositing on cursor moves, snaps, CAD edits, opacity changes
  if (
    sameSurface &&
    snap.panX === view.panX &&
    snap.panY === view.panY &&
    snap.zoom === view.zoom &&
    snap.tileRenderTick === tileRenderTick &&
    (isInteracting || snap.quality === 'high')
  ) {
    ctx.save();
    ctx.globalAlpha = clampedOpacity;
    ctx.drawImage(offscreenCanvas, 0, 0, width, height);
    ctx.restore();
    return snap.stats;
  }

  // 2. Active Gesture Fast Path: transform cached snapshot quad while panning/zooming, restore full high quality on settle
  if (isInteracting && sameSurface) {
    const scale = view.zoom / snap.zoom;
    const destX = width / 2 + (snap.panX - view.panX) * view.zoom - (snap.width / 2) * scale;
    const destY = height / 2 - (snap.panY - view.panY) * view.zoom - (snap.height / 2) * scale;
    const destW = snap.width * scale;
    const destH = snap.height * scale;

    const maxEdgeGap = Math.max(24, Math.min(width, height) * 0.08);
    const fitsWithMargin =
      scale >= 0.68 &&
      scale <= 1.65 &&
      destX <= maxEdgeGap &&
      destY <= maxEdgeGap &&
      destX + destW >= width - maxEdgeGap &&
      destY + destH >= height - maxEdgeGap;

    if (fitsWithMargin) {
      ctx.save();
      ctx.globalAlpha = clampedOpacity;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(offscreenCanvas, destX, destY, destW, destH);
      ctx.restore();
      return snap.stats;
    }
  }

  const centerLL = worldToLonLat(view.panX, view.panY, config.sourceCrs);
  if (!centerLL) return null;

  // Reject wildly out-of-bounds Earth coordinates (e.g., degenerate zooms)
  if (centerLL.lat < -85 || centerLL.lat > 85 || centerLL.lon < -180 || centerLL.lon > 180) {
    return null;
  }

  const layerSpec: { id: 'Base' | 'Satellite'; ext: 'png' | 'jpeg'; minZoom: number; maxZoom: number } =
    config.layer === 'Satellite'
      ? { id: 'Satellite', ext: 'jpeg', minZoom: 6, maxZoom: 19 }
      : { id: 'Base', ext: 'png', minZoom: 6, maxZoom: 19 };

  const minZoom = layerSpec.minZoom;
  const maxZoom = layerSpec.maxZoom;

  const cosLat = Math.max(0.15, Math.cos((centerLL.lat * Math.PI) / 180));
  const rawZ = Math.round(Math.log2((EARTH_CIRCUMFERENCE / TILE_SIZE) * view.zoom * cosLat));
  let z = Math.max(minZoom, Math.min(maxZoom, rawZ));

  // Project 4 viewport corners to EPSG:3857 Mercator
  const halfW = (width / 2) / view.zoom;
  const halfH = (height / 2) / view.zoom;
  const worldCorners: Point2D[] = [
    { x: view.panX - halfW, y: view.panY + halfH },
    { x: view.panX + halfW, y: view.panY + halfH },
    { x: view.panX - halfW, y: view.panY - halfH },
    { x: view.panX + halfW, y: view.panY - halfH }
  ];

  let minMx = Infinity, maxMx = -Infinity, minMy = Infinity, maxMy = -Infinity;
  for (let i = 0; i < worldCorners.length; i++) {
    const m = worldToMercator(worldCorners[i].x, worldCorners[i].y, config.sourceCrs);
    if (!m) continue;
    if (m.x < minMx) minMx = m.x;
    if (m.x > maxMx) maxMx = m.x;
    if (m.y < minMy) minMy = m.y;
    if (m.y > maxMy) maxMy = m.y;
  }

  if (!Number.isFinite(minMx) || !Number.isFinite(minMy)) return null;

  const computeTileBounds = (zoomLevel: number) => {
    const n = Math.pow(2, zoomLevel);
    const tileMercSize = EARTH_CIRCUMFERENCE / n;
    const minTx = Math.max(0, Math.min(n - 1, Math.floor((minMx + ORIGIN_SHIFT) / tileMercSize)));
    const maxTx = Math.max(0, Math.min(n - 1, Math.floor((maxMx + ORIGIN_SHIFT) / tileMercSize)));
    const minTy = Math.max(0, Math.min(n - 1, Math.floor((ORIGIN_SHIFT - maxMy) / tileMercSize)));
    const maxTy = Math.max(0, Math.min(n - 1, Math.floor((ORIGIN_SHIFT - minMy) / tileMercSize)));
    return { n, tileMercSize, minTx, maxTx, minTy, maxTy };
  };

  let bounds = computeTileBounds(z);
  while (z > minZoom && (bounds.maxTx - bounds.minTx + 1) * (bounds.maxTy - bounds.minTy + 1) > 48) {
    z--;
    bounds = computeTileBounds(z);
  }

  const totalSlots = (bounds.maxTx - bounds.minTx + 1) * (bounds.maxTy - bounds.minTy + 1);
  if (totalSlots > 80) return null;

  // Prepare offscreen canvas sized to physical canvas pixels for crisp single-pass opacity compositing
  const targetW = Math.max(1, Math.round(width * dpr));
  const targetH = Math.max(1, Math.round(height * dpr));
  if (offscreenCanvas.width !== targetW || offscreenCanvas.height !== targetH) {
    offscreenCanvas.width = targetW;
    offscreenCanvas.height = targetH;
  }

  const offCtx = offscreenCanvas.getContext('2d');
  if (!offCtx) return null;

  const quality: 'low' | 'high' = isInteracting ? 'low' : 'high';
  offCtx.setTransform(1, 0, 0, 1, 0, 0);
  offCtx.clearRect(0, 0, targetW, targetH);
  offCtx.scale(dpr, dpr);
  offCtx.imageSmoothingEnabled = true;
  offCtx.imageSmoothingQuality = quality;

  const cx = width / 2;
  const cy = height / 2;
  const toScreen = (wp: Point2D) => ({
    x: cx + (wp.x - view.panX) * view.zoom,
    y: cy - (wp.y - view.panY) * view.zoom
  });

  // Cache projected grid vertices (cols+1) x (rows+1) so adjacent tiles share exact corner coordinates
  const cols = bounds.maxTx - bounds.minTx + 1;
  const rows = bounds.maxTy - bounds.minTy + 1;
  const screenGrid: ({ x: number; y: number } | null)[][] = Array.from({ length: rows + 1 }, () =>
    new Array(cols + 1).fill(null)
  );

  for (let r = 0; r <= rows; r++) {
    const ty = bounds.minTy + r;
    const my = ORIGIN_SHIFT - ty * bounds.tileMercSize;
    for (let c = 0; c <= cols; c++) {
      const tx = bounds.minTx + c;
      const mx = -ORIGIN_SHIFT + tx * bounds.tileMercSize;
      const w = mercatorToWorld(mx, my, config.sourceCrs);
      screenGrid[r][c] = w ? toScreen(w) : null;
    }
  }

  let loadedCount = 0;
  let loadingCount = 0;
  let errorCount = 0;
  const padCss = Math.max(0.85, 1.25 / dpr);

  for (let r = 0; r < rows; r++) {
    const ty = bounds.minTy + r;
    for (let c = 0; c < cols; c++) {
      const tx = bounds.minTx + c;
      const sTL = screenGrid[r][c];
      const sTR = screenGrid[r][c + 1];
      const sBL = screenGrid[r + 1][c];
      if (!sTL || !sTR || !sBL) continue;

      // Affine matrix mapping tile (0..256, 0..256) to screen coordinates
      const dRx = sTR.x - sTL.x;
      const dRy = sTR.y - sTL.y;
      const dBx = sBL.x - sTL.x;
      const dBy = sBL.y - sTL.y;

      const a = dRx / TILE_SIZE;
      const b = dRy / TILE_SIZE;
      const cc = dBx / TILE_SIZE;
      const d = dBy / TILE_SIZE;
      const e = sTL.x;
      const f = sTL.y;

      // Expand opaque base tiles by ~0.85 CSS px on all 4 sides in screen space
      // so fractional affine anti-aliasing never leaks background hairline grids.
      const screenW = Math.hypot(dRx, dRy);
      const screenH = Math.hypot(dBx, dBy);
      const padX = Math.min(3, (padCss * TILE_SIZE) / Math.max(1, screenW));
      const padY = Math.min(3, (padCss * TILE_SIZE) / Math.max(1, screenH));

      const entry = vworldTileCache.getOrFetch(layerSpec.id, layerSpec.ext, z, tx, ty, onTileLoaded, onTileError);

      if (entry.status === 'loaded' && entry.img) {
        loadedCount++;
        offCtx.save();
        offCtx.transform(a, b, cc, d, e, f);
        offCtx.drawImage(
          entry.img,
          0,
          0,
          TILE_SIZE,
          TILE_SIZE,
          -padX,
          -padY,
          TILE_SIZE + padX * 2,
          TILE_SIZE + padY * 2
        );
        offCtx.restore();
      } else {
        if (entry.status === 'loading') loadingCount++;
        else errorCount++;

        // Draw lower-zoom cached parent tile inside exact child bounds for flicker-free zoom
        const parent = vworldTileCache.findParentLoadedTile(layerSpec.id, z, tx, ty, layerSpec.minZoom);
        if (parent) {
          offCtx.save();
          offCtx.transform(a, b, cc, d, e, f);
          offCtx.drawImage(
            parent.img,
            parent.sx,
            parent.sy,
            parent.size,
            parent.size,
            -padX,
            -padY,
            TILE_SIZE + padX * 2,
            TILE_SIZE + padY * 2
          );
          offCtx.restore();
        }
      }
    }
  }

  // Composite offscreen map onto main CAD canvas at desired opacity
  ctx.save();
  ctx.globalAlpha = clampedOpacity;
  ctx.drawImage(offscreenCanvas, 0, 0, width, height);
  ctx.restore();

  const stats: VWorldRenderStats = {
    zoomLevel: z,
    tileCount: totalSlots,
    loadedCount,
    loadingCount,
    errorCount
  };

  snapshotRef.current = {
    panX: view.panX,
    panY: view.panY,
    zoom: view.zoom,
    width,
    height,
    dpr,
    layer: config.layer,
    sourceCrs: config.sourceCrs,
    tileRenderTick,
    quality,
    stats
  };

  return stats;
}
