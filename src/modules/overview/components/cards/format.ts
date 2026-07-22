const transportModeLabels: Record<string, string> = {
  bicycle: "자전거",
  bus: "버스",
  car: "자동차",
  cycling: "자전거",
  driving: "자동차",
  ferry: "페리",
  flight: "항공",
  flying: "항공",
  motorcycle: "오토바이",
  running: "달리기",
  subway: "지하철",
  train: "기차",
  transit: "대중교통",
  unknown: "알 수 없음",
  walking: "도보",
};

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

export function formatTransportMode(mode: string): string {
  return transportModeLabels[mode.toLowerCase()] ?? formatFallbackLabel(mode);
}

export function formatFallbackLabel(label: string): string {
  return label.toLowerCase() === "unknown" ? "알 수 없음" : label;
}
