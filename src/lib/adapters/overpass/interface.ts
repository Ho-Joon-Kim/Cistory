export interface SubwayLineData {
  osmRelationId: number;
  name?: string;
  nameEn?: string;
  ref?: string;
  colour?: string;
  operator?: string;
  network?: string;
  geometry: GeoJSON.MultiLineString;
}

export interface SubwayStationData {
  osmNodeId: number;
  name?: string;
  nameEn?: string;
  wikidata?: string;
  lat: number;
  lon: number;
  lineRefs: string[];
}

export interface SubwayFetchResult {
  lines: SubwayLineData[];
  stations: SubwayStationData[];
}

export interface OverpassAdapter {
  fetchSubwayInBbox(bbox: [number, number, number, number]): Promise<SubwayFetchResult>;
}
