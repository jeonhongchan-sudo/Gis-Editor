/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import proj4 from 'proj4';
import { CoordinateSystem } from '../types/cad';

export const COORDINATE_SYSTEMS: Record<string, CoordinateSystem> = {
  'EPSG:5186': {
    code: 'EPSG:5186',
    name: 'Korea 2000 / 중부원점 (GRS80 2010)',
    description: '서울, 경기, 충청, 전북 등 중부지역 토목/GIS 표준 (X=200,000 / Y=600,000)',
    proj4Def: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    wktPrj: 'PROJCS["Korea 2000 / Central Belt 2010",GEOGCS["Korea 2000",DATUM["Geocentric_datum_of_Korea",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",127],PARAMETER["scale_factor",1],PARAMETER["false_easting",200000],PARAMETER["false_northing",600000],UNIT["metre",1]]',
    isTM: true
  },
  'EPSG:5187': {
    code: 'EPSG:5187',
    name: 'Korea 2000 / 동부원점 (GRS80 2010)',
    description: '강원 동해안, 경북, 경남, 대구, 부산, 울산 등 동부지역 (X=200,000 / Y=600,000)',
    proj4Def: '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    wktPrj: 'PROJCS["Korea 2000 / East Belt 2010",GEOGCS["Korea 2000",DATUM["Geocentric_datum_of_Korea",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",129],PARAMETER["scale_factor",1],PARAMETER["false_easting",200000],PARAMETER["false_northing",600000],UNIT["metre",1]]',
    isTM: true
  },
  'EPSG:5185': {
    code: 'EPSG:5185',
    name: 'Korea 2000 / 서부원점 (GRS80 2010)',
    description: '백령도, 서해안 도서지역 (X=200,000 / Y=600,000)',
    proj4Def: '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    wktPrj: 'PROJCS["Korea 2000 / West Belt 2010",GEOGCS["Korea 2000",DATUM["Geocentric_datum_of_Korea",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",125],PARAMETER["scale_factor",1],PARAMETER["false_easting",200000],PARAMETER["false_northing",600000],UNIT["metre",1]]',
    isTM: true
  },
  'EPSG:5188': {
    code: 'EPSG:5188',
    name: 'Korea 2000 / 동해원점 (GRS80 2010)',
    description: '울릉도, 독도 등 동해 도서지역 (X=200,000 / Y=600,000)',
    proj4Def: '+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    wktPrj: 'PROJCS["Korea 2000 / East Sea Belt 2010",GEOGCS["Korea 2000",DATUM["Geocentric_datum_of_Korea",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",131],PARAMETER["scale_factor",1],PARAMETER["false_easting",200000],PARAMETER["false_northing",600000],UNIT["metre",1]]',
    isTM: true
  },
  'EPSG:5181': {
    code: 'EPSG:5181',
    name: 'Korea 1985 / 중부원점 (카카오맵 타원체)',
    description: '카카오 지도 API 및 구 GRS80/Bessel 기준 (Y가산수치 500,000)',
    proj4Def: '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs',
    wktPrj: 'PROJCS["Korea 1985 / Central Belt",GEOGCS["Korea 1985",DATUM["Korean_Datum_1985",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",127],PARAMETER["scale_factor",1],PARAMETER["false_easting",200000],PARAMETER["false_northing",500000],UNIT["metre",1]]',
    isTM: true
  },
  'EPSG:5174': {
    code: 'EPSG:5174',
    name: 'Bessel 1841 / 구 지적도 중부원점',
    description: '구 토지/임야대장, 구 지적도면 (보정 중부원점)',
    proj4Def: '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43',
    wktPrj: 'PROJCS["Korean 1985 / Modified Central Belt",GEOGCS["Korean 1985",DATUM["Korean_Datum_1985",SPHEROID["Bessel 1841",6377397.155,299.1528128]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",127.0028902777778],PARAMETER["scale_factor",1],PARAMETER["false_easting",200000],PARAMETER["false_northing",500000],UNIT["metre",1]]',
    isTM: true
  },
  'EPSG:5179': {
    code: 'EPSG:5179',
    name: 'Korea 2000 / 통합기준점 (UTM-K)',
    description: '전국 단일 좌표계, 네이버 지도, 산림청 등 (X=1,000,000 / Y=2,000,000)',
    proj4Def: '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs',
    wktPrj: 'PROJCS["Korea 2000 / Unified CS",GEOGCS["Korea 2000",DATUM["Geocentric_datum_of_Korea",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",127.5],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",1000000],PARAMETER["false_northing",2000000],UNIT["metre",1]]',
    isTM: true
  },
  'EPSG:4326': {
    code: 'EPSG:4326',
    name: 'WGS84 경위도 (GPS / 위경도)',
    description: '스마트폰 GPS, 구글 어스 등 위도/경도 도(Degree) 단위 좌표',
    proj4Def: '+proj=longlat +datum=WGS84 +no_defs',
    wktPrj: 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
    isTM: false
  },
  'LOCAL': {
    code: 'LOCAL',
    name: '로컬/현장 상대좌표계 (CAD 단위: m)',
    description: '공사 현장 자체 기준점 또는 일반 캐드 상대좌표 (m 단위 평면 직교 좌표계)',
    proj4Def: '',
    wktPrj: '',
    isTM: false
  }
};

// Initialize proj4 definitions
Object.values(COORDINATE_SYSTEMS).forEach(cs => {
  if (cs.proj4Def && cs.code !== 'EPSG:4326') {
    try {
      proj4.defs(cs.code, cs.proj4Def);
    } catch {
      // Ignored if already registered
    }
  }
});

/**
 * Convert coordinates between coordinate systems if needed.
 */
export function transformCoords(
  x: number, 
  y: number, 
  fromCrs: string, 
  toCrs: string
): { x: number; y: number } {
  if (fromCrs === toCrs || fromCrs === 'LOCAL' || toCrs === 'LOCAL') {
    return { x, y };
  }
  try {
    const [nx, ny] = proj4(fromCrs, toCrs, [x, y]);
    return { x: nx, y: ny };
  } catch (err) {
    console.warn(`Projection conversion failed from ${fromCrs} to ${toCrs}:`, err);
    return { x, y };
  }
}

/**
 * Format meters for CAD engineering display
 */
export function formatCADCoord(val: number): string {
  return val.toLocaleString('ko-KR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  });
}
