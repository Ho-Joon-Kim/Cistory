# Death Stranding 1 & 2 — 디자인 시스템 레퍼런스

> 웹페이지 디자인 시 Death Stranding에서 영감을 받았다고 느낄 수 있도록 핵심 디자인 요소를 정리한 문서

---

## 1. 핵심 디자인 철학

Death Stranding의 UI는 **"기능적 미래주의(Functional Futurism)"**를 표방한다. 일반적인 게임 UI의 화려한 애니메이션과 과장된 연출 대신, 택배 기사(포터)가 실제로 사용할 법한 실용적 인터페이스를 지향한다. 모든 텍스트 한 줄이 배달 계획과 생존에 직결되는 정보라는 전제 하에, 장식을 최소화하고 데이터 밀도를 높인 디자인이 특징이다.

DS2에서는 이 철학을 유지하면서도 더 **직관적이고 깔끔한 방향**으로 개선되었다. 메뉴 탐색 깊이가 줄고, 퀵 액세스 단축키가 도입되어 정보 접근성이 크게 향상되었다.

### 키워드로 요약
- 미니멀리즘 + 데이터 밀도의 공존
- Diegetic UI (게임 세계관 안에 존재하는 UI)
- 홀로그램/Cuff Links 디바이스 기반 시각 언어
- "연결(Strand)"이라는 테마의 시각적 반복


---

## 2. 컬러 팔레트

### 2-1. DS1 — 차가운 블루 기조

| 역할 | 색상 | HEX (근사치) | 비고 |
|------|------|-------------|------|
| **Primary (배경)** | 다크 네이비/차콜 | `#0A0E17` ~ `#141A2B` | 거의 검정에 가까운 깊은 남색 |
| **Secondary (UI 표면)** | 반투명 다크 블루 | `#1A2540` (opacity 80~90%) | 패널, 카드 배경 |
| **Accent (메인 강조)** | 소프트 시안/스카이 블루 | `#5CAACC` ~ `#7EC8E3` | 선택 상태, 활성 요소, 텍스트 강조 |
| **Accent 2 (경고/중요)** | 코럴 오렌지 | `#DC8D18` ~ `#E8A030` | 경고, 화물 손상, 중요 수치 |
| **Accent 3 (카이랄/특수)** | 골드 | `#F4D136` ~ `#FFD700` | 카이랄 결정, 특수 이벤트, 좋아요(Like) |
| **텍스트 (기본)** | 밝은 그레이~화이트 | `#C8D0DC` ~ `#EAEEF4` | 본문 텍스트 |
| **텍스트 (비활성)** | 중간 그레이 | `#6B7280` ~ `#8892A0` | 비활성 메뉴, 보조 정보 |
| **위험/BT 관련** | 검정~타르 블랙 | `#0C0C0C` + 오일 반사 효과 | BT 존, 위험 지역 표시 |

### 2-2. DS2 — 따뜻한 톤 추가

DS2에서는 DS1의 블루 기조를 유지하면서도 새로운 환경(열대, 해변 등)에 맞춰 **따뜻한 앰버/모래색 계열**이 추가되었다. 전반적으로 약간 더 밝고 가독성이 개선된 톤을 사용한다.

| 추가된 역할 | 색상 | HEX (근사치) |
|------------|------|-------------|
| 모래/해변 톤 | 웜 베이지 | `#CAB4A1` ~ `#D4C4B0` |
| 따뜻한 강조 | 앰버 | `#DC8D18` |
| 새 환경 악센트 | 연한 모스 그린 | `#5A7A5A` ~ `#6B8E6B` |

### 웹 적용 가이드
- **배경은 극도로 어둡게**: `#0A0E17` 또는 `#0C1220` 수준의 다크 배경이 핵심
- **텍스트와 배경 사이 대비를 시안 계열로**: 밝은 화이트보다는 `#C8D0E0` 정도의 차가운 화이트
- **호버/포커스 상태에 시안 glow 효과**: `box-shadow: 0 0 15px rgba(92, 170, 204, 0.3)`
- **중요 수치나 강조에만 오렌지~골드 사용**: 전체 대비 5% 이하로 아껴 써야 게임의 느낌이 살아남


---

## 3. 타이포그래피

### 3-1. 게임 내 실제 사용 폰트

| 폰트명 | 용도 | 특징 |
|--------|------|------|
| **Sackers Gothic** Medium | 로고, 챕터 타이틀, 캐릭터 네임카드 | 우아한 올캡 세리프. 브랜딩 전용 |
| **SST** Roman | UI 본문 텍스트 전반 | Sony 표준 서체. 높은 가독성의 산세리프 |
| **EX PS Medium Neon** | 짧은 대형 텍스트, 디스플레이 | 네온 스타일 디스플레이 서체. 커스텀 |
| **BO CD Mono** Light/Medium | 숫자, 무게, 거리 등 데이터 | 기하학적 모노스페이스. VCR 디스플레이 느낌 |
| **Bank Gothic** Light | 메인 메뉴 (일부 분석 기준) | 각진 모서리의 퓨처리스틱 산세리프 |

### 3-2. 웹에서 대체 가능한 폰트 매핑

| 게임 폰트 | 웹 대체 (무료) | 웹 대체 (유료) |
|-----------|----------------|----------------|
| Sackers Gothic | Cinzel, Cormorant SC | Sackers Gothic 직접 구매 |
| SST Roman | Inter, IBM Plex Sans | Neue Haas Grotesk, Suisse Int'l |
| BO CD Mono | JetBrains Mono, Space Mono, IBM Plex Mono | GT America Mono, Atlas Typewriter |
| Bank Gothic | Orbitron, Rajdhani | Bank Gothic 직접 구매, Eurostile |
| EX PS Neon (Display) | Exo 2, Michroma | Eurostile Extended |

### 3-3. 타이포그래피 스타일 규칙

- **자간(Letter Spacing)**: 넓은 자간이 핵심. 타이틀은 `letter-spacing: 0.15em ~ 0.3em`, 본문도 `0.02em ~ 0.05em`
- **대문자 사용**: 타이틀, 라벨, 카테고리명은 거의 항상 `text-transform: uppercase`
- **폰트 웨이트**: 전반적으로 Light~Regular 위주. Bold를 거의 사용하지 않음
- **숫자 표시**: 모노스페이스 서체로 분리. 데이터/수치는 항상 별도 폰트 패밀리
- **줄간격**: 본문 1.6~1.8, 데이터 라벨 1.2~1.4


---

## 4. 레이아웃 & 그리드 시스템

### 4-1. 핵심 레이아웃 패턴

**"정보 밀집형 좌측 정렬"**이 기본 구조다. 화면 왼쪽에 데이터 패널이 수직으로 쌓이고, 오른쪽은 맵이나 3D 뷰어가 차지하는 비대칭 레이아웃이 반복된다.

```
┌─────────────────────────────────────────────────┐
│ [라벨: 대분류]              [상단 우측: 보조 정보]│
│                                                  │
│ ┌──────────────┐   ┌──────────────────────────┐  │
│ │              │   │                          │  │
│ │  데이터 패널  │   │     메인 콘텐츠 영역      │  │
│ │  (세부 정보)  │   │     (맵 / 뷰어 / 이미지)  │  │
│ │              │   │                          │  │
│ │  ───────────  │   │                          │  │
│ │  리스트 아이템 │   │                          │  │
│ │  리스트 아이템 │   │                          │  │
│ │  리스트 아이템 │   │                          │  │
│ └──────────────┘   └──────────────────────────┘  │
│                                                  │
│ [하단: 액션 바 / 컨텍스트 힌트]                    │
└─────────────────────────────────────────────────┘
```

### 4-2. 웹 적용 시 그리드

- **2컬럼 비대칭**: `grid-template-columns: 320px 1fr` 또는 `30% 70%`
- **정보 계층 구분**: 좌측 패널은 정보 나열, 우측은 비주얼 중심
- **풀스크린 레이아웃**: 스크롤 최소화, 한 화면에 정보 집약 (`100vh` 섹션)
- **여백**: 전반적으로 넓은 내부 패딩 (`padding: 2rem ~ 3rem`), 요소 간 간격도 넓음


---

## 5. UI 컴포넌트 & 시각 요소

### 5-1. Strand Lines (스트랜드 라인)

**가장 상징적인 시각 요소.** 메뉴에서 선택된 항목에 길게 뻗는 가느다란 수평선이 반복적으로 등장한다. 이 "실(Strand)"은 연결이라는 게임 테마를 시각적으로 구현한 것이다.

```css
/* 스트랜드 라인 CSS 예시 */
.strand-line {
  height: 1px;
  background: linear-gradient(
    90deg, 
    rgba(92,170,204,0.8) 0%, 
    rgba(92,170,204,0.2) 60%, 
    transparent 100%
  );
  width: 100%;
  /* 또는 선택 상태에서 동적으로 width 애니메이션 */
}

.menu-item.active::after {
  content: '';
  display: block;
  height: 1px;
  background: linear-gradient(90deg, #5CAACC, transparent);
  animation: strand-extend 0.4s ease-out forwards;
}

@keyframes strand-extend {
  from { width: 0; }
  to { width: 100%; }
}
```

### 5-2. 패널 & 카드

- **반투명 배경**: `background: rgba(20, 30, 50, 0.85)` + `backdrop-filter: blur(8px)`
- **테두리**: 극히 얇은 1px 시안 보더 또는 보더 없음. `border: 1px solid rgba(92,170,204,0.15)`
- **모서리**: 직각(border-radius: 0) 또는 매우 미세한 라운딩(2px). 둥근 카드 절대 금지
- **그림자**: 전통적인 box-shadow 대신 시안 glow를 미세하게 사용

### 5-3. 버튼 & 인터랙션

- **버튼 스타일**: 아웃라인 버튼 위주. 채워진(filled) 버튼은 최소 사용
- **호버 효과**: 배경이 서서히 채워지는 느낌 + 시안 glow
- **선택 상태**: 좌측에 시안 수직 바 또는 스트랜드 라인 확장
- **트랜지션**: 느리고 부드러움. `transition: all 0.3s ~ 0.5s ease`

```css
.ds-button {
  background: transparent;
  border: 1px solid rgba(92,170,204,0.3);
  color: #C8D0DC;
  padding: 0.75rem 2rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  font-size: 0.8rem;
  transition: all 0.4s ease;
}

.ds-button:hover {
  background: rgba(92,170,204,0.1);
  border-color: rgba(92,170,204,0.6);
  box-shadow: 0 0 20px rgba(92,170,204,0.15);
  color: #EAEEF4;
}
```

### 5-4. 홀로그램 & Diegetic 요소

게임 내에서 Sam의 Cuff Links(수갑형 웨어러블 컴퓨터)가 투사하는 홀로그램이 핵심 UI 장치다. 이것을 웹에서 표현하려면:

- **스캔라인 효과**: 반투명 수평선이 주기적으로 스캔하듯 지나가는 애니메이션
- **미세한 글리치/떨림**: `transform: translateX(1px)` 정도의 미세한 랜덤 떨림
- **시안 발광**: 텍스트나 아이콘에 `text-shadow: 0 0 10px rgba(92,170,204,0.5)` 
- **노이즈 텍스처**: 매우 미세한 그레인 오버레이

```css
/* 홀로그램 텍스트 효과 */
.holo-text {
  color: #7EC8E3;
  text-shadow: 
    0 0 5px rgba(126,200,227,0.4),
    0 0 10px rgba(126,200,227,0.2);
  animation: holo-flicker 4s ease-in-out infinite;
}

@keyframes holo-flicker {
  0%, 100% { opacity: 1; }
  92% { opacity: 1; }
  93% { opacity: 0.8; }
  94% { opacity: 1; }
  96% { opacity: 0.9; }
  97% { opacity: 1; }
}

/* 스캔라인 오버레이 */
.scanline-overlay::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(92,170,204,0.03) 2px,
    rgba(92,170,204,0.03) 4px
  );
  pointer-events: none;
}
```

### 5-5. 아이콘 & 픽토그램

- **스타일**: 극도로 단순한 라인 아이콘. 선 두께 1~1.5px
- **기하학적**: 삼각형, 원, 직선 조합. 유기적 곡선 최소화
- **네온 사인 스타일**: 게임 내 도로 표지판은 네온사인처럼 단순한 기하학적 라인으로 디자인
- **Odradek 센서**: 게임의 상징적 장비. 십자형(+) 변형 모티프로 활용 가능


---

## 6. 모션 & 애니메이션 원칙

### 6-1. 전반적 특징

Death Stranding의 UI 모션은 **"억제된 정밀함"**으로 요약된다. 과도한 바운스나 스프링 효과가 없고, 모든 것이 선형적이고 기계적으로 움직인다.

- **속도**: 느림~중간. 200ms ~ 500ms 범위
- **이징**: `ease-out` 또는 `linear` 위주. `ease-in-out` 가끔 사용
- **바운스/스프링**: 사용 안 함
- **방향**: 수평 이동이 주. 좌→우 확장이 기본 패턴

### 6-2. 주요 모션 패턴

| 패턴 | 설명 | 타이밍 |
|------|------|--------|
| **Strand Extend** | 선택 시 수평선이 좌→우로 확장 | 300~400ms ease-out |
| **Fade In/Up** | 패널이나 텍스트가 약간 위로 이동하며 나타남 | 400~600ms ease-out |
| **Data Cascade** | 리스트 아이템이 위→아래로 순차 등장 | 각 50~80ms 딜레이 |
| **Glow Pulse** | 활성 요소의 발광이 천천히 밝아졌다 어두워짐 | 2~4s ease-in-out |
| **Scanline Sweep** | 홀로그램 위를 수평 스캔라인이 천천히 이동 | 3~6s linear |
| **Glitch Micro** | 텍스트 전환 시 1~2프레임 글리치 | 50~100ms |


---

## 7. DS1 vs DS2 — 주요 UI 차이점

| 요소 | DS1 | DS2: On the Beach |
|------|-----|-------------------|
| **메뉴 깊이** | 깊은 중첩. 여러 단계 탐색 필요 | 얕은 구조. 퀵 액세스 메뉴 도입 |
| **확인 동작** | 거의 모든 작업에 홀드(길게 누르기) 요구 | 단일 버튼 프레스로 간소화 |
| **색상 톤** | 차가운 블루 일변도 | 블루 기조 + 따뜻한 앰버/베이지 톤 추가 |
| **정보 구조** | 데이터 밀집형. 한 화면에 많은 정보 | 정보 우선순위 명확화. 핵심 데이터 강조 |
| **미션 추적** | 기본적인 미션 로그 | 개선된 미션 트래킹 + 음성 가이드 |
| **카고 관리** | 복잡한 다단계 인벤토리 | D-패드 퀵 액세스로 즉시 조정 가능 |
| **가이드 시스템** | 최소한의 튜토리얼 | Guided Mode / Survival Mode 선택 가능 |
| **전반적 느낌** | 냉정하고 고립된 포터의 도구 | 여전히 기능적이지만 더 접근성 있는 인터페이스 |


---

## 8. 웹 디자인 적용 — 실전 가이드

### 8-1. "이건 Death Stranding이다"라고 느끼게 하는 5가지

1. **극도로 어두운 네이비 배경 + 시안 악센트 컬러**: 이것만으로 50%는 달성
2. **넓은 자간의 올캡 타이틀**: `letter-spacing: 0.15em; text-transform: uppercase`
3. **스트랜드 라인 (가느다란 시안 수평선)**: 선택/호버 상태에서 좌→우 확장
4. **직각 모서리 + 반투명 패널**: `border-radius: 0` + `backdrop-filter: blur()`
5. **데이터에 모노스페이스 폰트 사용**: 숫자/수치에 별도의 기하학적 모노 서체

### 8-2. CSS 변수 시스템 예시

```css
:root {
  /* Colors */
  --ds-bg-deep: #0A0E17;
  --ds-bg-surface: rgba(20, 30, 50, 0.85);
  --ds-bg-elevated: rgba(30, 45, 70, 0.7);
  
  --ds-cyan: #5CAACC;
  --ds-cyan-dim: rgba(92, 170, 204, 0.3);
  --ds-cyan-glow: rgba(92, 170, 204, 0.15);
  
  --ds-amber: #DC8D18;
  --ds-gold: #F4D136;
  --ds-coral: #E8A030;
  
  --ds-text-primary: #EAEEF4;
  --ds-text-secondary: #C8D0DC;
  --ds-text-muted: #6B7280;
  
  /* Typography */
  --ds-font-display: 'Cinzel', 'Cormorant SC', serif;  /* Sackers Gothic 대체 */
  --ds-font-body: 'Inter', 'IBM Plex Sans', sans-serif;  /* SST 대체 */
  --ds-font-mono: 'JetBrains Mono', 'Space Mono', monospace;  /* BO CD Mono 대체 */
  --ds-font-ui: 'Rajdhani', 'Orbitron', sans-serif;  /* Bank Gothic 대체 */
  
  --ds-ls-wide: 0.15em;
  --ds-ls-wider: 0.25em;
  --ds-ls-body: 0.03em;
  
  /* Spacing */
  --ds-space-xs: 0.5rem;
  --ds-space-sm: 1rem;
  --ds-space-md: 2rem;
  --ds-space-lg: 3rem;
  --ds-space-xl: 5rem;
  
  /* Motion */
  --ds-duration-fast: 200ms;
  --ds-duration-normal: 400ms;
  --ds-duration-slow: 600ms;
  --ds-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### 8-3. 피해야 할 것

- ❌ 둥근 모서리 카드 (border-radius > 4px)
- ❌ 밝은 배경 또는 화이트 테마
- ❌ 팝한 그라디언트나 네온 과다 사용
- ❌ 바운시한 스프링 애니메이션
- ❌ 이모지나 일러스트 스타일 아이콘
- ❌ 화려한 멀티컬러 팔레트
- ❌ Bold 웨이트 남용 (Light~Regular가 기본)


---

## 9. 참고 리소스

| 리소스 | URL | 설명 |
|--------|-----|------|
| Game UI Database (DS1) | gameuidatabase.com/gameData.php?id=371 | DS1 UI 스크린샷 전체 아카이브 |
| Game UI Database (DS2) | gameuidatabase.com/gameData.php?id=2145 | DS2 UI 스크린샷 아카이브 |
| Interface In Game (DS) | interfaceingame.com/games/death-stranding/ | 카테고리별 UI 스크린샷 |
| Fonts In Use 분석 | fontsinuse.com/uses/67648/death-stranding-video-game | 폰트 상세 분석 |
| Nevaeh Li 포트폴리오 | nevaehli.com/uiux-analysis/death-stranding | Shape language 분석 + 리디자인 |
| Casey Matsumoto | caseymatsumoto.com/death-stranding | 공식 UI 아티스트 포트폴리오 |
| Behance 컨셉 | behance.net/gallery/88012813 | DS 웹사이트 UI/UX 컨셉 |
| React UI 클론 | github.com/flagrede/death-stranding-ui | React로 구현한 DS UI |


---

## 10. Cistory 적용 분석 — 현재 상태 진단 & 제안

> 대상 서비스: Cistory (개발자 활동 대시보드 — Mapbox 지도 + Git 커밋 타임라인 + 코딩 세션 추적)
> 기술 스택: Mapbox, shadcn/ui 기반

### 10-1. 현재 디자인과 DS 디자인 시스템의 Gap 분석

| 요소 | 현재 Cistory 상태 | DS 디자인 시스템 목표 | Gap 크기 |
|------|-------------------|----------------------|----------|
| **배경색** | 다크 톤 (✅ 이미 양호) | 극도로 어두운 네이비 `#0A0E17` | 🟡 미세 조정 — 현재 배경이 약간 회색 기운. 좀 더 네이비/블루 쉬프트 필요 |
| **메인 악센트** | 비비드 그린 `#00FF88` 계열 | 소프트 시안 `#5CAACC` | 🔴 큰 변화 — 색상 자체가 다름. 그린→시안 전환이 DS 느낌의 핵심 |
| **보조 악센트** | 퍼플 (맵 마커, TypeScript) | 퍼플은 DS에 없음. 앰버/골드가 대안 | 🟡 부분 조정 — 퍼플을 유지하되 용도 재정의, 또는 골드로 전환 |
| **카드 모서리** | border-radius ~8px (추정) | border-radius: 0~2px | 🟡 간단한 변경 |
| **카드 배경** | 불투명 다크 서피스 | 반투명 + backdrop-filter: blur | 🟡 중간 — 맵 위에 오버레이 시 효과적 |
| **자간/대문자** | 일반적인 자간, 혼용 케이스 | 넓은 자간 + 올캡 라벨 | 🟡 타이포 규칙 적용 필요 |
| **데이터 폰트** | 커밋 해시에 모노 사용 (✅) | 모든 수치 데이터에 모노 일괄 적용 | 🟢 거의 충족 — 확장만 하면 됨 |
| **레이아웃** | 좌: 맵, 우: 타임라인 (✅) | 비대칭 2컬럼이 DS의 기본 구조 | 🟢 이미 일치 |
| **타임라인 구조** | 시간대별 그룹 + 수직 라인 (✅) | DS의 스트랜드 라인 + 데이터 캐스케이드와 잘 맞음 | 🟢 구조적으로 매우 호환 |
| **헤더 웨이브폼** | 컬러풀 바 차트 (그린/옐로/레드) | DS 스타일이면 시안 단색 + glow | 🟡 색상 통일 필요 |

### 10-2. 핵심 변경 우선순위

#### 🔴 P0 — 이것만 바꿔도 DS 느낌이 확 살아나는 것

**1. 메인 악센트 컬러: 그린 → 시안 전환**

현재 Cistory의 아이덴티티 컬러인 비비드 그린을 시안으로 전환하는 것이 가장 임팩트가 큰 단일 변경이다.

```css
/* Before (현재) */
--accent: #00FF88;  /* 또는 유사한 비비드 그린 */

/* After (DS 적용) */
--accent: #5CAACC;           /* 메인 시안 */
--accent-bright: #7EC8E3;    /* 밝은 시안 (호버, 활성) */
--accent-dim: rgba(92,170,204,0.3);  /* 흐린 시안 (보더, 비활성) */
--accent-glow: rgba(92,170,204,0.15); /* 글로우 효과용 */
```

적용 대상:
- 맵 위 경로 라인 (Mapbox lineLayer color)
- 타임라인 수직 연결선
- 타임라인 도트 (활성 상태)
- 코딩 세션 프로그레스바의 기본 색상
- 호버/포커스 보더

**2. Mapbox 경로 라인 스타일링**

현재 경로 라인은 불투명한 그린 실선인데, DS의 스트랜드 라인처럼 바꾸면 극적인 효과가 나온다.

```javascript
// Mapbox GL JS — DS 스타일 경로 레이어
map.addLayer({
  id: 'route-glow',
  type: 'line',
  source: 'route',
  paint: {
    'line-color': '#5CAACC',
    'line-width': 6,
    'line-opacity': 0.15,
    'line-blur': 4,        // 글로우 효과
  }
});

map.addLayer({
  id: 'route-line',
  type: 'line',
  source: 'route',
  paint: {
    'line-color': '#5CAACC',
    'line-width': 1.5,     // DS답게 가늘게
    'line-opacity': 0.8,
  }
});

// 포인트 마커도 시안으로
map.addLayer({
  id: 'route-points',
  type: 'circle',
  source: 'points',
  paint: {
    'circle-color': '#5CAACC',
    'circle-radius': 4,
    'circle-blur': 0.3,    // 약간의 글로우
    'circle-stroke-width': 1,
    'circle-stroke-color': 'rgba(92,170,204,0.5)',
  }
});
```

이 이중 레이어(glow + thin line) 패턴이 DS 경로 표시의 핵심이다. 굵은 단일 라인 대신, 넓은 반투명 글로우 뒤에 가느다란 실선을 겹치는 것.

#### 🟡 P1 — DS 분위기를 완성하는 변경

**3. shadcn/ui Card 커스터마이징**

```css
/* shadcn Card 오버라이드 */
.card, [data-slot="card"] {
  border-radius: 2px;                              /* 직각에 가까운 모서리 */
  background: rgba(14, 20, 35, 0.85);              /* 반투명 다크 네이비 */
  backdrop-filter: blur(8px);
  border: 1px solid rgba(92, 170, 204, 0.08);      /* 거의 안 보이는 시안 보더 */
  transition: border-color 0.4s ease;
}

.card:hover, [data-slot="card"]:hover {
  border-color: rgba(92, 170, 204, 0.2);            /* 호버 시 보더 미세하게 밝아짐 */
  box-shadow: 0 0 20px rgba(92, 170, 204, 0.05);   /* 미세 글로우 */
}
```

**4. 타임라인 라벨 타이포그래피**

```css
/* "오늘", "어제", "저녁", "오후" 등 시간대 라벨 */
.timeline-label {
  font-family: var(--ds-font-ui);        /* Rajdhani 또는 Orbitron */
  text-transform: uppercase;
  letter-spacing: 0.15em;
  font-weight: 300;                       /* Light 웨이트 */
  font-size: 0.75rem;
  color: var(--ds-text-muted);
}

/* 커밋 해시, 수치 데이터 */
.commit-hash, .stat-value {
  font-family: var(--ds-font-mono);      /* JetBrains Mono */
  letter-spacing: 0.05em;
}

/* additions/deletions 수치 — 이건 현재도 잘 되어있음. 색상만 조정 */
.additions { color: #5CAACC; }           /* 그린 → 시안 */
.deletions { color: #DC8D18; }           /* 레드 → 앰버/오렌지 (DS의 경고색) */
```

**5. 코딩 세션 프로그레스바**

현재 TypeScript(퍼플)/Other(그린)/JSON(앰버) 바를 DS 팔레트로 재매핑:

```css
/* DS 팔레트 기반 언어 색상 */
--lang-typescript: #5CAACC;     /* 시안 — 주 언어는 메인 악센트 */
--lang-other: #7EC8E3;          /* 밝은 시안 */
--lang-json: #DC8D18;           /* 앰버 — 설정/데이터 파일 */
--lang-css: #F4D136;            /* 골드 — 스타일링 */
--lang-python: #CAB4A1;         /* 웜 베이지 — DS2 팔레트 */
```

또는 퍼플을 완전히 포기하기 어렵다면, 퍼플을 "특수/카이랄" 포지션으로 남기되 채도를 낮추고 DS 세계관과 연결:

```css
--lang-typescript: #8B7EC8;     /* 탈채도 퍼플 — "카이랄 에너지" 포지션 */
```

#### 🟢 P2 — 디테일 폴리시

**6. 헤더 웨이브폼 바**

현재 `Cistory` 옆 컬러풀 바 차트를 DS 스타일로:
- 모든 바를 시안 단일색으로 통일
- 높이에 따른 opacity 변화: 높은 바 = 밝은 시안, 낮은 바 = 어두운 시안
- 선택적으로 미세한 glow 추가

```css
.waveform-bar {
  background: #5CAACC;
  opacity: calc(0.3 + var(--bar-height) * 0.7);  /* 높이에 비례하는 투명도 */
  box-shadow: 0 0 3px rgba(92,170,204,0.3);
}
```

**7. "다음 동기화: 10분 후" — DS 스캐너 스타일**

이 동기화 타이머를 DS의 Odradek 센서 스캔 느낌으로 처리하면 세계관 연결이 강해진다:

```css
.sync-timer {
  font-family: var(--ds-font-mono);
  letter-spacing: 0.1em;
  font-size: 0.75rem;
  color: var(--ds-text-muted);
  /* 동기화 중일 때만 시안 glow */
}

.sync-timer.syncing {
  color: var(--ds-cyan);
  text-shadow: 0 0 8px var(--ds-cyan-glow);
  animation: holo-flicker 2s ease-in-out infinite;
}
```

**8. 맵 마커 — 퍼플 원 → 시안/골드 포인트**

현재 보라색 원형 마커를 DS의 홀로그래픽 포인트로:

```javascript
// 주요 위치 (오래 머문 곳) — 시안 + 글로우
paint: {
  'circle-color': '#5CAACC',
  'circle-radius': 6,
  'circle-opacity': 0.9,
  'circle-blur': 0.2,
  'circle-stroke-width': 1,
  'circle-stroke-color': '#7EC8E3',
}

// 경유 포인트 (잠깐 들른 곳) — 시안 디머
paint: {
  'circle-color': '#5CAACC',
  'circle-radius': 3,
  'circle-opacity': 0.4,
}
```

### 10-3. Cistory ↔ Death Stranding 세계관 연결점

이 서비스의 특성이 DS 세계관과 놀라울 정도로 잘 맞는 부분이 있다:

| Cistory 기능 | DS 세계관 대응 | 디자인 적용 아이디어 |
|-------------|---------------|---------------------|
| **이동 경로 맵** | Sam의 배달 경로 | 맵 위 경로를 "스트랜드 라인"으로 표현. 얇은 시안 선 + 글로우 |
| **커밋 타임라인** | 배달 완료 로그 (Delivery Log) | 시간순 수직 스트랜드 라인 + 순차 등장 애니메이션 |
| **코딩 세션 시간** | 미션 소요 시간 | 모노스페이스 숫자 + `6h 30m` 포맷은 DS 미션 타이머와 동일 |
| **+additions / -deletions** | 화물 무게/수량 | 모노 폰트 + 시안(추가)/앰버(제거) 색상 대비 |
| **커밋 해시** | 화물 ID / 주문 번호 | `c50eaac` 같은 해시가 DS의 `Order No.XXX`와 같은 포지션 |
| **동기화 타이머** | Odradek 스캔 주기 | 주기적 스캔 애니메이션과 연결 |
| **디바이스명 (TitanV, TitanV-Mac-1)** | 장비/터미널 ID | DS에서 각 시설이 고유 ID를 갖는 것과 동일 |
| **거리 (4.4km)** | 배달 거리 | DS 미션의 핵심 데이터 |
| **헤더 웨이브폼** | 카이랄 네트워크 신호 | 커밋 빈도 = 네트워크 활동 시각화 |

### 10-4. shadcn/ui 토큰 오버라이드 예시

shadcn의 CSS 변수 시스템에 DS 팔레트를 매핑하면:

```css
/* globals.css 또는 tailwind theme — Dark 모드 (DS 테마) */
.dark, [data-theme="death-stranding"] {
  /* 배경 계층 */
  --background: 222 47% 5%;          /* #0A0E17 → hsl(222, 47%, 5%) */
  --foreground: 216 25% 93%;         /* #EAEEF4 */
  
  --card: 220 40% 10%;               /* #141A2B */
  --card-foreground: 216 20% 85%;    /* #C8D0DC */
  
  --popover: 222 40% 8%;
  --popover-foreground: 216 25% 93%;
  
  /* 메인 컬러 → 시안 */
  --primary: 195 45% 57%;            /* #5CAACC */
  --primary-foreground: 222 47% 5%;
  
  /* 보조 (패널 표면) */
  --secondary: 220 35% 15%;
  --secondary-foreground: 216 20% 85%;
  
  /* 뮤트 */
  --muted: 220 20% 18%;
  --muted-foreground: 218 10% 50%;   /* #6B7280 */
  
  /* 강조 → 앰버 */
  --accent: 35 80% 48%;              /* #DC8D18 */
  --accent-foreground: 216 25% 93%;
  
  /* 경고/파괴 */
  --destructive: 35 80% 48%;         /* DS에선 레드 대신 앰버 계열 */
  --destructive-foreground: 216 25% 93%;
  
  /* 보더, 인풋, 링 */
  --border: 220 30% 15%;
  --input: 220 30% 15%;
  --ring: 195 45% 57%;               /* 포커스 링 = 시안 */
  
  /* 차트 컬러 (코딩 세션 바 등) */
  --chart-1: 195 45% 57%;            /* 시안 (TypeScript) */
  --chart-2: 195 45% 70%;            /* 밝은 시안 (Other) */
  --chart-3: 35 80% 48%;             /* 앰버 (JSON) */
  --chart-4: 45 88% 58%;             /* 골드 (CSS) */
  --chart-5: 25 40% 65%;             /* 웜 베이지 (기타) */
  
  /* 커스텀 DS 전용 변수 */
  --ds-glow: 195 45% 57%;
  --ds-strand: rgba(92, 170, 204, 0.6);
  --ds-strand-dim: rgba(92, 170, 204, 0.15);
  
  /* border-radius 전역 축소 */
  --radius: 0.125rem;                /* 2px — DS 스타일 직각 */
}
```

### 10-5. Mapbox 다크 스타일 추천

Mapbox의 기본 dark 스타일도 괜찮지만, DS 느낌을 극대화하려면:

```javascript
// mapbox style URL — 추천 순서
// 1. 직접 커스텀 (Mapbox Studio에서 조정)
// 2. 기본 다크에서 라벨 색상만 조정

map.setStyle('mapbox://styles/mapbox/dark-v11');

// 스타일 로드 후 라벨/도로 색상 조정
map.on('style.load', () => {
  // 도로 라벨 색상을 DS 뮤트로
  map.setPaintProperty('road-label', 'text-color', '#4A5568');
  
  // 물/강을 더 어둡게
  map.setPaintProperty('water', 'fill-color', '#080C14');
  
  // 배경을 더 네이비로
  map.setPaintProperty('background', 'background-color', '#0A0E17');
});
```

### 10-6. 커밋 카드 컴포넌트 — DS 스타일 리디자인 가이드

현재 커밋 카드를 DS 디자인 언어로 재구성한 구조:

```
┌─────────────────────────────────────────────────────────┐
│ ◇ TitanV  ·  15h ago  ·  ⚙ Ho-Joon-Kim/influencer-crm │  ← 메타 라인: 모노, 뮤트
│                                                          │
│ feat(ui): enhance search UX and table interactions       │  ← 커밋 메시지: Regular 웨이트
│ 검색 진행 시간 표시, 테이블 행 전체 클릭...               │  ← 설명: 뮤트 컬러
│                                                          │
│ ─────────────────────────────────────────── (strand)     │  ← 시안 그라디언트 수평선
│                                                          │
│ ⌐ 3ea9742   + 221   − 226   ☰ 19 files                 │  ← 수치: 모노스페이스
│         ^^^^cyan    ^^^^amber                            │
└─────────────────────────────────────────────────────────┘
```

핵심 변경점:
- 카드 내부 메타 정보와 수치 사이에 **시안 스트랜드 라인** 구분자 추가
- `+ additions`를 그린→시안으로, `- deletions`를 레드→앰버로
- 커밋 해시(`3ea9742`)에 시안 tint
- 디바이스명은 DS의 시설/터미널 ID 취급 — 올캡, 넓은 자간
- 머지 뱃지(`🔀 머지`)를 DS 스타일 아웃라인 뱃지로

### 10-7. 전체 적용 시 Before/After 색상 매핑 요약

```
현재 Cistory          →    DS 테마 Cistory
──────────────────────────────────────────
비비드 그린 (경로)    →    시안 #5CAACC (스트랜드)
퍼플 (맵 마커)        →    시안 #7EC8E3 (밝은 시안) 또는 골드 #F4D136
그린 (+additions)     →    시안 #5CAACC
레드 (-deletions)     →    앰버 #DC8D18
퍼플 (TypeScript)     →    시안 #5CAACC
그린 (Other)          →    밝은 시안 #7EC8E3
앰버 (JSON)           →    앰버 유지 #DC8D18
컬러풀 웨이브폼       →    시안 단일색 (높이에 따른 opacity)
초록 타임라인 도트     →    시안 도트 + 글로우
```


---

## 11. Cistory 애니메이션 가이드라인

> Death Stranding의 "억제된 정밀함(Restrained Precision)" 모션 철학을 Cistory의 각 컴포넌트에 구체적으로 매핑한 가이드.
> 구현 기준: Framer Motion + CSS Animations + Mapbox GL JS

### 11-1. 핵심 모션 원칙 — Cistory 버전

DS의 UI 모션은 **홀로그램 디바이스(Cuff Links)가 데이터를 투사하는 과정**에서 영감을 받았다. 모든 정보는 "공간에 그려지는" 느낌이어야 하며, 물리적 관성이 아닌 **디지털 신호의 전송과 수신**처럼 움직여야 한다.

#### 금지 패턴 (Anti-patterns)

| 패턴 | 이유 | DS 대안 |
|------|------|--------|
| `type: "spring"` (바운스) | DS는 물리 기반 모션을 사용하지 않음 | `type: "tween"` + `ease: [0.16, 1, 0.3, 1]` |
| `bounce: 0.3` 이상 | 홀로그램은 튀지 않는다 | `bounce: 0` 또는 tween 사용 |
| scale 기반 등장 (팝업) | 게임 내 어떤 요소도 "터지듯" 등장하지 않음 | opacity + translateX/Y 조합 |
| 360° 회전 | 과도한 장식적 모션 | 없음. 필요 시 최대 90° |
| 다채로운 컬러 전환 | 팔레트가 극도로 제한적 | opacity만으로 강조/비강조 전환 |
| 즉각적 전환 (0ms) | DS는 항상 약간의 지연이 있음. 신호 전송 지연 느낌 | 최소 150ms |

#### 핵심 이징 함수

```typescript
// Cistory DS 모션 프리셋 — Framer Motion용
export const dsEasing = {
  // 메인 이징: DS 메뉴 전환과 동일한 커브
  // 빠르게 시작 → 부드럽게 감속 (홀로그램이 "착지"하는 느낌)
  out: [0.16, 1, 0.3, 1],

  // 데이터 로드: 살짝 느리게 시작 → 매끄럽게 끝남
  // DS의 데이터 패널이 나타나는 커브
  inOut: [0.4, 0, 0.2, 1],

  // 선형: 스캔라인, 프로그레스바 등 기계적 요소
  linear: [0, 0, 1, 1],

  // 스트랜드 라인 확장: 약간의 가속 후 일정 속도
  strand: [0.25, 0.1, 0.25, 1],
} as const;

// 타이밍 상수
export const dsTiming = {
  instant: 0.15,     // 최소 전환 (호버 피드백)
  fast: 0.25,        // 빠른 상태 변화 (토글, 선택)
  normal: 0.4,       // 기본 전환 (패널 등장, 카드 전환)
  slow: 0.6,         // 큰 영역 전환 (페이지, 모달)
  crawl: 1.0,        // 맵 카메라 이동
  ambient: 3.0,      // 배경 루프 (글로우 펄스, 스캔라인)
} as const;
```

### 11-2. 컴포넌트별 애니메이션 상세 스펙

---

#### A. 타임라인 커밋 카드 — 등장 애니메이션

DS의 **Delivery Log(배달 완료 로그)**에서 각 항목이 순차적으로 나타나는 패턴. 데이터 캐스케이드의 핵심 구현.

```tsx
// Framer Motion — 커밋 카드 스태거 등장
import { motion } from 'framer-motion';

// 부모 컨테이너: 타임라인 그룹 (예: "어제", "저녁")
const timelineGroupVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      // DS 데이터 캐스케이드: 첫 아이템 등장 전 약간의 지연
      delayChildren: 0.15,
      // 각 카드 사이 간격 — DS는 50~80ms
      staggerChildren: 0.06,
      when: "beforeChildren",
    },
  },
};

// 개별 커밋 카드
const commitCardVariants = {
  hidden: {
    opacity: 0,
    x: -12,       // DS는 수평 이동이 주. 좌→우 방향
    // y 이동을 쓰지 않는 것이 DS 스타일 (수평 우선)
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],  // dsEasing.out
    },
  },
  // 카드 퇴장 (스크롤 아웃 또는 필터 변경 시)
  exit: {
    opacity: 0,
    x: -8,
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 0.2, 1],
    },
  },
};

// 사용
<motion.div variants={timelineGroupVariants} initial="hidden" animate="visible">
  {commits.map((commit) => (
    <motion.div
      key={commit.hash}
      variants={commitCardVariants}
      layout  // 카드 재정렬 시 부드러운 레이아웃 전환
    >
      <CommitCard commit={commit} />
    </motion.div>
  ))}
</motion.div>
```

**핵심 포인트:**
- `x: -12` → `x: 0`: DS는 좌→우 수평 이동이 기본. `y` 이동(아래에서 올라오기)은 DS답지 않음
- `staggerChildren: 0.06`: DS의 빠른 캐스케이드. 0.1 이상이면 너무 느림
- `delayChildren: 0.15`: 그룹 라벨("어제", "저녁")이 먼저 보인 후 카드가 연이어 등장

---

#### B. 타임라인 그룹 라벨 — "오늘", "어제", "저녁" 등

DS에서 메뉴 카테고리 헤더가 나타나는 방식. 텍스트가 먼저 나타나고, 그 아래 스트랜드 라인이 뻗어나간다.

```tsx
const groupLabelVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
};

// 라벨 아래 스트랜드 라인 (시안 구분선)
const strandLineVariants = {
  hidden: { scaleX: 0, originX: 0 },   // 좌측 기준점에서 시작
  visible: {
    scaleX: 1,
    transition: {
      duration: 0.5,
      ease: [0.25, 0.1, 0.25, 1],      // dsEasing.strand
      delay: 0.2,                        // 라벨 뒤에 등장
    },
  },
};
```

```css
/* CSS 대안 — 스트랜드 라인 구분자 */
.timeline-group-divider {
  height: 1px;
  background: linear-gradient(90deg, 
    rgba(92,170,204,0.4) 0%, 
    rgba(92,170,204,0.1) 40%, 
    transparent 100%
  );
  transform-origin: left;
  animation: strand-extend 0.5s cubic-bezier(0.25, 0.1, 0.25, 1) 0.2s both;
}

@keyframes strand-extend {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
```

---

#### C. 커밋 카드 — 호버 & 선택 상태

DS 메뉴 아이템의 호버 반응: **즉각적이지 않지만 빠른** 피드백. 배경이 서서히 밝아지고, 좌측 보더가 나타난다.

```tsx
// Framer Motion — 카드 호버
<motion.div
  whileHover={{
    backgroundColor: "rgba(92, 170, 204, 0.04)",
    borderColor: "rgba(92, 170, 204, 0.15)",
    transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
  }}
  // 선택(클릭) 시 좌측 시안 바 활성화
  animate={isSelected ? "selected" : "idle"}
  variants={{
    idle: {
      borderLeftColor: "rgba(92, 170, 204, 0)",
      borderLeftWidth: 2,
    },
    selected: {
      borderLeftColor: "rgba(92, 170, 204, 0.8)",
      borderLeftWidth: 2,
      transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
    },
  }}
/>
```

```css
/* CSS 대안 — 카드 호버 */
.commit-card {
  border-left: 2px solid transparent;
  transition:
    background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.4s ease;
}

.commit-card:hover {
  background-color: rgba(92, 170, 204, 0.04);
  border-left-color: rgba(92, 170, 204, 0.15);
}

.commit-card.selected {
  border-left-color: rgba(92, 170, 204, 0.8);
  box-shadow: 
    inset 3px 0 8px rgba(92, 170, 204, 0.06),  /* 내부 좌측 글로우 */
    0 0 15px rgba(92, 170, 204, 0.03);           /* 외부 미세 글로우 */
}
```

---

#### D. 코딩 세션 프로그레스바 — 확장 애니메이션

DS의 **화물 내구도 바(Durability Bar)**에서 영감. 바가 좌에서 우로 채워지는데, 각 세그먼트가 약간의 시차를 두고 등장.

```tsx
// 프로그레스바 세그먼트 (TypeScript, Other, JSON 등)
const progressSegmentVariants = {
  hidden: { scaleX: 0, originX: 0 },
  visible: (i: number) => ({
    scaleX: 1,
    transition: {
      duration: 0.6,
      ease: [0.25, 0.1, 0.25, 1],    // dsEasing.strand
      delay: i * 0.1,                  // 세그먼트 순차 등장
    },
  }),
};

// 사용
{segments.map((seg, i) => (
  <motion.div
    key={seg.language}
    custom={i}
    variants={progressSegmentVariants}
    initial="hidden"
    animate="visible"
    style={{
      width: `${seg.percentage}%`,
      backgroundColor: seg.color,
    }}
  />
))}
```

```css
/* CSS 대안 — 프로그레스바 확장 */
.progress-bar {
  display: flex;
  overflow: hidden;
  border-radius: 1px;
  height: 6px;
  background: rgba(92, 170, 204, 0.05);
}

.progress-segment {
  transform-origin: left;
  animation: bar-fill 0.6s cubic-bezier(0.25, 0.1, 0.25, 1) both;
}

.progress-segment:nth-child(1) { animation-delay: 0s; }
.progress-segment:nth-child(2) { animation-delay: 0.1s; }
.progress-segment:nth-child(3) { animation-delay: 0.2s; }

@keyframes bar-fill {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
```

---

#### E. 수치 카운터 — +additions / -deletions

DS에서 화물 개수나 무게가 변할 때의 숫자 전환. **숫자가 직접 롤링하거나 깜빡이며 전환**된다.

```tsx
import { motion, AnimatePresence } from 'framer-motion';

// 숫자 변경 시 글리치 스타일 전환
const numberVariants = {
  enter: {
    opacity: 0,
    y: -8,
    filter: "blur(2px)",              // 홀로그램 포커싱 효과
  },
  center: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      duration: 0.3,
      ease: [0.16, 1, 0.3, 1],
    },
  },
  exit: {
    opacity: 0,
    y: 8,
    filter: "blur(2px)",
    transition: { duration: 0.15 },
  },
};

// 사용 — AnimatePresence로 값 변경 감지
<AnimatePresence mode="popLayout">
  <motion.span
    key={value}                        // 값이 바뀔 때마다 재마운트
    variants={numberVariants}
    initial="enter"
    animate="center"
    exit="exit"
    className="font-mono tabular-nums"  // 모노스페이스 + 고정폭 숫자
  >
    {value.toLocaleString()}
  </motion.span>
</AnimatePresence>
```

```css
/* CSS 보조 — 수치에 시안 하이라이트 플래시 */
.stat-value.updated {
  animation: value-flash 0.6s ease-out;
}

@keyframes value-flash {
  0%   { color: #7EC8E3; text-shadow: 0 0 8px rgba(126,200,227,0.4); }
  100% { color: inherit; text-shadow: none; }
}
```

---

#### F. 맵 경로 — 드로잉 애니메이션

DS에서 **맵 위에 배달 경로가 그려지는 과정**. 경로가 시작점에서 끝점까지 점진적으로 나타나는 "ant path" 변형.

```javascript
// Mapbox GL JS — 경로 점진적 드로잉 애니메이션
function animateRoute(map, routeCoords) {
  const totalSteps = routeCoords.length;
  let currentStep = 0;

  // 글로우 레이어 (뒤)
  map.addSource('route-animated', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
  });

  map.addLayer({
    id: 'route-glow',
    type: 'line',
    source: 'route-animated',
    paint: {
      'line-color': '#5CAACC',
      'line-width': 6,
      'line-opacity': 0.15,
      'line-blur': 4,
    },
  });

  map.addLayer({
    id: 'route-core',
    type: 'line',
    source: 'route-animated',
    paint: {
      'line-color': '#5CAACC',
      'line-width': 1.5,
      'line-opacity': 0.8,
    },
  });

  // 선두 포인트 (이동하는 시안 점)
  map.addSource('route-head', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'Point', coordinates: routeCoords[0] } },
  });

  map.addLayer({
    id: 'route-head-glow',
    type: 'circle',
    source: 'route-head',
    paint: {
      'circle-color': '#7EC8E3',
      'circle-radius': 6,
      'circle-opacity': 0.4,
      'circle-blur': 0.5,
    },
  });

  map.addLayer({
    id: 'route-head-dot',
    type: 'circle',
    source: 'route-head',
    paint: {
      'circle-color': '#5CAACC',
      'circle-radius': 3,
      'circle-opacity': 1,
    },
  });

  // 애니메이션 루프
  function step() {
    if (currentStep >= totalSteps) return;

    currentStep++;
    const sliced = routeCoords.slice(0, currentStep);

    // 경로 업데이트
    map.getSource('route-animated').setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: sliced },
    });

    // 선두 포인트 이동
    map.getSource('route-head').setData({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: sliced[sliced.length - 1] },
    });

    requestAnimationFrame(step);
  }

  step();
}
```

**DS 포인트:**
- 이중 레이어(glow + thin core)로 스트랜드 라인 표현
- 선두에 밝은 시안 점이 이동하면서 "그려지는" 느낌
- 완성된 경로는 정적으로 유지 (반복 애니메이션 없음. DS는 루프를 거의 안 씀)

---

#### G. 맵 카메라 전환

커밋 카드를 클릭했을 때 해당 위치로 맵이 이동하는 전환. DS의 맵에서 거점 간 이동하는 느낌.

```javascript
// Mapbox flyTo — DS 스타일 느린 카메라 이동
function flyToCommitLocation(map, coords) {
  map.flyTo({
    center: coords,
    zoom: 15,
    speed: 0.6,           // DS답게 느리게 (기본값 1.2의 절반)
    curve: 1.2,           // 부드러운 줌 커브
    easing: (t) => {
      // DS ease-out 커브: cubic-bezier(0.16, 1, 0.3, 1) 근사
      return 1 - Math.pow(1 - t, 3);
    },
    essential: true,
  });
}

// 타임라인 날짜 그룹 전환 시 — 전체 경로 뷰로 복귀
function fitToRouteOverview(map, bounds) {
  map.fitBounds(bounds, {
    padding: { top: 40, bottom: 40, left: 40, right: 40 },
    duration: 1200,       // 1.2초 — DS의 느린 맵 전환
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
}
```

---

#### H. 타임라인 도트 & 수직 연결선

DS의 **타임라인 노드 + 스트랜드 연결선** 패턴을 직접 구현.

```tsx
// 타임라인 도트 — 활성/비활성 전환
const timelineDotVariants = {
  inactive: {
    scale: 1,
    boxShadow: "0 0 0px rgba(92,170,204,0)",
  },
  active: {
    scale: 1,              // DS는 scale 변화를 쓰지 않음
    boxShadow: "0 0 10px rgba(92,170,204,0.4)",
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};
```

```css
/* 타임라인 수직 연결선 — 스트랜드 스타일 */
.timeline-connector {
  width: 1px;
  background: linear-gradient(
    180deg,
    rgba(92,170,204,0.4) 0%,
    rgba(92,170,204,0.15) 50%,
    rgba(92,170,204,0.4) 100%
  );
  /* 등장 시 위에서 아래로 그려짐 */
  animation: connector-draw 0.4s cubic-bezier(0.25, 0.1, 0.25, 1) both;
  transform-origin: top;
}

@keyframes connector-draw {
  from { transform: scaleY(0); }
  to   { transform: scaleY(1); }
}

/* 활성 타임라인 도트 — 시안 글로우 펄스 */
.timeline-dot.active {
  background: #5CAACC;
  box-shadow: 0 0 8px rgba(92,170,204,0.4);
  animation: dot-pulse 3s ease-in-out infinite;
}

@keyframes dot-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(92,170,204,0.4); }
  50%      { box-shadow: 0 0 14px rgba(92,170,204,0.6); }
}
```

---

#### I. 헤더 웨이브폼 (커밋 활동 시각화)

DS의 **카이랄 네트워크 신호** 스타일. 각 바가 순차적으로 나타나며, 전체가 "신호를 수신하는" 느낌.

```tsx
// 웨이브폼 바 스태거 등장
const waveformContainerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.015,   // 매우 빠른 캐스케이드 (바가 많으므로)
    },
  },
};

const waveformBarVariants = {
  hidden: {
    scaleY: 0,
    originY: "bottom",        // 아래에서 위로 자라남
    opacity: 0,
  },
  visible: {
    scaleY: 1,
    opacity: 1,
    transition: {
      duration: 0.3,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};
```

```css
/* CSS 대안 — 웨이브폼 바 등장 */
.waveform-bar {
  background: #5CAACC;
  transform-origin: bottom;
  animation: bar-grow 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* 각 바에 CSS 변수로 딜레이 주입 */
.waveform-bar { animation-delay: calc(var(--bar-index) * 15ms); }

@keyframes bar-grow {
  from { transform: scaleY(0); opacity: 0; }
  to   { transform: scaleY(1); opacity: var(--bar-opacity); }
}
```

---

#### J. 동기화 상태 인디케이터

DS의 **Odradek 스캔** 주기를 연상시키는 동기화 표시.

```css
/* 동기화 대기 중 — 미세 펄스 */
.sync-indicator.idle .sync-icon {
  animation: sync-idle-pulse 4s ease-in-out infinite;
}

@keyframes sync-idle-pulse {
  0%, 100% { opacity: 0.4; }
  50%      { opacity: 0.6; }
}

/* 동기화 진행 중 — 회전 + 글로우 */
.sync-indicator.syncing .sync-icon {
  animation: sync-active 1.5s linear infinite;
  filter: drop-shadow(0 0 4px rgba(92,170,204,0.4));
}

@keyframes sync-active {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* 동기화 완료 — 짧은 플래시 후 사라짐 */
.sync-indicator.complete .sync-icon {
  animation: sync-complete 0.6s ease-out forwards;
}

@keyframes sync-complete {
  0%   { color: #7EC8E3; filter: drop-shadow(0 0 8px rgba(126,200,227,0.5)); }
  60%  { color: #7EC8E3; filter: drop-shadow(0 0 4px rgba(126,200,227,0.3)); }
  100% { color: var(--ds-text-muted); filter: none; }
}
```

---

#### K. 페이지/뷰 전환

DS에서 메뉴 깊이를 이동할 때의 전환. 현재 화면이 좌로 밀려나고 새 화면이 우에서 등장.

```tsx
// 페이지 전환 — AnimatePresence + 수평 슬라이드
import { AnimatePresence, motion } from 'framer-motion';

const pageTransitionVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 40 : -40,      // DS: 큰 이동 없이 미세하게
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],
    },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -40 : 40,
    opacity: 0,
    transition: {
      duration: 0.25,
      ease: [0.4, 0, 0.2, 1],
    },
  }),
};

// 뷰 전환 시 전체 컨텐츠에 스캔라인 오버레이 한 번 스윕
const scanlineTransition = {
  hidden: { top: "-2px" },
  visible: {
    top: "100%",
    transition: {
      duration: 0.5,
      ease: "linear",
    },
  },
};
```

---

#### L. 토스트/알림 — 새 커밋 도착

DS에서 **새 주문 알림(Order Notification)**이 나타나는 방식. 화면 우측에서 미끄러져 들어오고, 시안 글로우가 한 번 번쩍인 후 안정화.

```tsx
const toastVariants = {
  enter: {
    x: 80,
    opacity: 0,
    boxShadow: "0 0 0px rgba(92,170,204,0)",
  },
  visible: {
    x: 0,
    opacity: 1,
    boxShadow: [
      "0 0 0px rgba(92,170,204,0)",       // 시작
      "0 0 20px rgba(92,170,204,0.3)",     // 플래시 피크
      "0 0 8px rgba(92,170,204,0.1)",      // 안정화
    ],
    transition: {
      x: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
      opacity: { duration: 0.3 },
      boxShadow: { duration: 0.8, times: [0, 0.3, 1] },
    },
  },
  exit: {
    x: 40,
    opacity: 0,
    transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
  },
};
```

---

### 11-3. 앰비언트(배경) 애니메이션

DS의 분위기를 유지하기 위한 **항상 돌아가는** 미세한 애니메이션. CPU 부담 최소화 필수.

```css
/* 
 * 앰비언트 애니메이션은 반드시 다음 규칙을 따른다:
 * 1. transform/opacity만 사용 (GPU 가속)
 * 2. will-change 선언
 * 3. 3초 이상의 긴 주기
 * 4. prefers-reduced-motion 존중
 */

@media (prefers-reduced-motion: no-preference) {
  /* 맵 영역 스캔라인 오버레이 */
  .map-scanline::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      180deg,
      transparent 0%,
      rgba(92,170,204,0.02) 50%,
      transparent 100%
    );
    height: 30%;
    width: 100%;
    will-change: transform;
    animation: map-scan 6s linear infinite;
    pointer-events: none;
  }

  @keyframes map-scan {
    from { transform: translateY(-30%); }
    to   { transform: translateY(430%); }
  }

  /* 헤더 로고 옆 미세 글로우 펄스 */
  .logo-glow {
    will-change: opacity;
    animation: logo-pulse 4s ease-in-out infinite;
  }

  @keyframes logo-pulse {
    0%, 100% { opacity: 0.6; }
    50%      { opacity: 1; }
  }

  /* 활성 타임라인 도트 글로우 (현재 시간대) */
  .current-time-dot {
    will-change: box-shadow;
    animation: current-pulse 3s ease-in-out infinite;
  }

  @keyframes current-pulse {
    0%, 100% { box-shadow: 0 0 6px rgba(92,170,204,0.3); }
    50%      { box-shadow: 0 0 12px rgba(92,170,204,0.5); }
  }
}

/* 접근성: 모션 감소 설정 시 모든 앰비언트 중단 */
@media (prefers-reduced-motion: reduce) {
  .map-scanline::after,
  .logo-glow,
  .current-time-dot {
    animation: none !important;
  }
}
```

---

### 11-4. 인터랙션 마이크로 애니메이션

#### 버튼/뱃지 호버

```css
/* DS 스타일 아웃라인 버튼 — 느린 배경 채움 */
.ds-button {
  position: relative;
  overflow: hidden;
  transition:
    color 0.3s ease,
    border-color 0.3s ease;
}

/* 호버 시 좌→우 배경 채움 효과 */
.ds-button::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(92, 170, 204, 0.08);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
}

.ds-button:hover::before {
  transform: scaleX(1);
}

.ds-button:hover {
  border-color: rgba(92, 170, 204, 0.4);
  color: #EAEEF4;
}
```

#### 머지 뱃지 등장

```css
/* 머지 뱃지 — 짧은 글리치 후 안정화 */
.merge-badge {
  animation: badge-materialize 0.3s ease-out;
}

@keyframes badge-materialize {
  0%   { opacity: 0; transform: translateX(-4px); filter: blur(2px); }
  40%  { opacity: 0.8; transform: translateX(1px); filter: blur(0); }  /* 오버슈트 */
  100% { opacity: 1; transform: translateX(0); filter: blur(0); }
}
```

#### 드롭다운/셀렉트 열기

```tsx
// DS 스타일 드롭다운 — 위에서 아래로 펼쳐짐 (캐스케이드)
const dropdownVariants = {
  closed: {
    height: 0,
    opacity: 0,
    transition: {
      height: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
      opacity: { duration: 0.15 },
    },
  },
  open: {
    height: "auto",
    opacity: 1,
    transition: {
      height: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
      opacity: { duration: 0.2, delay: 0.05 },
      staggerChildren: 0.04,
      delayChildren: 0.1,
    },
  },
};

const dropdownItemVariants = {
  closed: { opacity: 0, x: -8 },
  open: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
  },
};
```

---

### 11-5. 데이터 로딩 상태 — 홀로그램 스켈레톤

일반적인 shimmer 스켈레톤 대신, DS의 **홀로그램이 수신 중인** 느낌의 로딩 패턴.

```css
/* DS 스켈레톤 — 시안 스캔라인이 지나가는 효과 */
.ds-skeleton {
  background: rgba(92, 170, 204, 0.03);
  border: 1px solid rgba(92, 170, 204, 0.05);
  border-radius: 2px;
  position: relative;
  overflow: hidden;
}

.ds-skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(92, 170, 204, 0.06) 40%,
    rgba(92, 170, 204, 0.06) 60%,
    transparent 100%
  );
  animation: skeleton-scan 2s linear infinite;
}

@keyframes skeleton-scan {
  from { transform: translateX(-100%); }
  to   { transform: translateX(100%); }
}

/* 스켈레톤 → 실제 콘텐츠 전환 */
.ds-skeleton.loaded {
  animation: skeleton-resolve 0.4s ease-out forwards;
}

@keyframes skeleton-resolve {
  0%   { border-color: rgba(92,170,204,0.15); }
  50%  { border-color: rgba(92,170,204,0.3); }  /* 순간 밝아짐 — 데이터 수신 완료 */
  100% { border-color: rgba(92,170,204,0.08); }
}
```

```tsx
// Framer Motion — 스켈레톤 → 콘텐츠 전환
<AnimatePresence mode="wait">
  {isLoading ? (
    <motion.div
      key="skeleton"
      className="ds-skeleton"
      exit={{
        opacity: 0,
        filter: "blur(2px)",
        transition: { duration: 0.2 },
      }}
    />
  ) : (
    <motion.div
      key="content"
      initial={{ opacity: 0, filter: "blur(4px)" }}   // 홀로그램 포커싱
      animate={{
        opacity: 1,
        filter: "blur(0px)",
        transition: {
          duration: 0.4,
          ease: [0.16, 1, 0.3, 1],
        },
      }}
    >
      <ActualContent />
    </motion.div>
  )}
</AnimatePresence>
```

---

### 11-6. 성능 가이드라인

```
✅ 사용해도 되는 속성 (GPU 가속)    ❌ 피해야 하는 속성 (리플로우 유발)
─────────────────────────          ─────────────────────────────────
transform: translateX/Y            width / height 직접 변경
transform: scale                   top / left / right / bottom
opacity                            padding / margin
filter: blur()                     border-width
box-shadow (앰비언트만)              font-size
clip-path (간단한 형태)              line-height
```

#### 성능 체크리스트

1. **앰비언트 애니메이션**: 항상 `will-change` 선언. 최대 3개까지만 동시 실행
2. **스태거 리스트**: 화면 밖 요소는 `IntersectionObserver`로 lazy 트리거
3. **Mapbox 레이어**: 경로 드로잉은 `requestAnimationFrame` 사용. setInterval 금지
4. **Framer Motion `layout`**: 큰 리스트에서는 `layoutScroll` 대신 `layoutId` 최소 사용
5. **prefers-reduced-motion**: 모든 앰비언트 + 스태거 애니메이션에 반드시 대응

```tsx
// Reduced motion 전역 체크
import { useReducedMotion } from 'framer-motion';

function usedsAnimation() {
  const prefersReduced = useReducedMotion();

  return {
    // 모션 감소 시: 스태거 없이 즉시 표시
    staggerDelay: prefersReduced ? 0 : 0.06,
    // 모션 감소 시: 기본 페이드만
    cardTransition: prefersReduced
      ? { duration: 0.15 }
      : { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
    // 앰비언트 완전 비활성화
    enableAmbient: !prefersReduced,
  };
}
```

---

### 11-7. 애니메이션 적용 우선순위 요약

| 우선순위 | 컴포넌트 | 애니메이션 | 임팩트 |
|---------|---------|-----------|--------|
| 🔴 P0 | 맵 경로 라인 | 이중 레이어 + 드로잉 애니메이션 | 서비스의 비주얼 아이덴티티 |
| 🔴 P0 | 커밋 카드 리스트 | 스태거 캐스케이드 등장 | 매 방문마다 보이는 메인 인터랙션 |
| 🟡 P1 | 카드 호버/선택 | 좌측 시안 바 + 배경 밝아짐 | 일상적 인터랙션 품질 |
| 🟡 P1 | 프로그레스바 | 좌→우 세그먼트 순차 확장 | 코딩 세션 강조 |
| 🟡 P1 | 데이터 로딩 | 홀로그램 스켈레톤 → 블러 해제 | 로딩 경험 차별화 |
| 🟢 P2 | 웨이브폼 바 | 아래→위 스태거 등장 | 브랜딩 요소 |
| 🟢 P2 | 타임라인 도트/라인 | 글로우 펄스 + 연결선 드로잉 | 분위기 강화 |
| 🟢 P2 | 동기화 타이머 | 스캔 주기 펄스 | 세계관 몰입 디테일 |
| 🟢 P2 | 맵 스캔라인 | 앰비언트 오버레이 스윕 | 홀로그램 분위기 |
| ⚪ P3 | 페이지 전환 | 수평 슬라이드 + 스캔라인 | 네비게이션 시에만 발생 |
| ⚪ P3 | 토스트 알림 | 우측 슬라이드 + 글로우 플래시 | 이벤트 기반 |
