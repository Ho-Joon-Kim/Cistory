/**
 * Reference cities drawn faintly on the trip route sketch for geographic
 * context (the sketch has no map tiles). City-centre coordinates; only the ones
 * that fall inside a trip's projected box are shown.
 */
export interface ReferenceCity {
  name: string;
  lat: number;
  lon: number;
}

export const REFERENCE_CITIES: readonly ReferenceCity[] = [
  { name: "서울", lat: 37.5665, lon: 126.978 },
  { name: "인천", lat: 37.4563, lon: 126.7052 },
  { name: "수원", lat: 37.2636, lon: 127.0286 },
  { name: "성남", lat: 37.42, lon: 127.1265 },
  { name: "고양", lat: 37.6584, lon: 126.832 },
  { name: "용인", lat: 37.2411, lon: 127.1776 },
  { name: "평택", lat: 36.9921, lon: 127.1129 },
  { name: "천안", lat: 36.8151, lon: 127.1139 },
  { name: "청주", lat: 36.6424, lon: 127.489 },
  { name: "충주", lat: 36.991, lon: 127.9259 },
  { name: "세종", lat: 36.48, lon: 127.289 },
  { name: "대전", lat: 36.3504, lon: 127.3845 },
  { name: "군산", lat: 35.9676, lon: 126.7368 },
  { name: "전주", lat: 35.8242, lon: 127.148 },
  { name: "광주", lat: 35.1595, lon: 126.8526 },
  { name: "목포", lat: 34.8118, lon: 126.3922 },
  { name: "순천", lat: 34.9507, lon: 127.4872 },
  { name: "여수", lat: 34.7604, lon: 127.6622 },
  { name: "대구", lat: 35.8714, lon: 128.6014 },
  { name: "구미", lat: 36.1195, lon: 128.3446 },
  { name: "안동", lat: 36.5684, lon: 128.7294 },
  { name: "포항", lat: 36.019, lon: 129.3435 },
  { name: "경주", lat: 35.8562, lon: 129.2247 },
  { name: "울산", lat: 35.5384, lon: 129.3114 },
  { name: "부산", lat: 35.1796, lon: 129.0756 },
  { name: "김해", lat: 35.2285, lon: 128.8894 },
  { name: "창원", lat: 35.228, lon: 128.6811 },
  { name: "진주", lat: 35.18, lon: 128.1076 },
  { name: "춘천", lat: 37.8813, lon: 127.7298 },
  { name: "원주", lat: 37.3422, lon: 127.9202 },
  { name: "강릉", lat: 37.7519, lon: 128.8761 },
  { name: "속초", lat: 38.207, lon: 128.5918 },
  { name: "제주", lat: 33.4996, lon: 126.5312 },
  { name: "서귀포", lat: 33.2541, lon: 126.56 },
];
