# Quickstart: Cistory 개발 환경 설정

## 사전 요구사항

- Node.js 20+ (LTS)
- pnpm 또는 yarn
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare 계정
- GitHub OAuth App
- Anthropic API Key

---

## 1. 프로젝트 초기화

```bash
# Cloudflare + Next.js 템플릿으로 프로젝트 생성
npm create cloudflare@latest -- cistory --framework=next

cd cistory

# 패키지 매니저 설정 (yarn 사용)
corepack enable
yarn set version stable
```

---

## 2. 의존성 설치

```bash
yarn add drizzle-orm @anthropic-ai/sdk better-auth
yarn add -D drizzle-kit wrangler @opennextjs/cloudflare

# shadcn/ui 초기화
npx shadcn@latest init
npx shadcn@latest add button card input select toggle toast
```

---

## 3. Cloudflare D1 데이터베이스 생성

```bash
# Cloudflare 로그인
wrangler login

# D1 데이터베이스 생성
wrangler d1 create cistory-db

# 출력된 database_id를 wrangler.jsonc에 추가
```

**wrangler.jsonc** 설정:
```jsonc
{
  "name": "cistory",
  "compatibility_date": "2024-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cistory",
      "database_id": "4facf9ea-e66c-4833-8e7a-9e93048cf5ba"
    }
  ]
}
```

---

## 4. GitHub OAuth App 생성

1. [GitHub Developer Settings](https://github.com/settings/developers) 접속
2. **New OAuth App** 클릭
3. 설정:
   - Application name: `Cistory`
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000/api/auth/github/callback`
4. **Client ID**와 **Client Secret** 복사

---

## 5. 환경 변수 설정

**.dev.vars** (로컬 개발용):
```bash
# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Better Auth
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=http://localhost:3000

# Anthropic Claude API
ANTHROPIC_API_KEY=your_anthropic_api_key
```

**Cloudflare Dashboard** (프로덕션):
- Workers & Pages > cistory > Settings > Variables에 동일하게 설정
- `BETTER_AUTH_URL`은 프로덕션 도메인으로 변경

---

## 6. 데이터베이스 마이그레이션

```bash
# 마이그레이션 생성
yarn drizzle-kit generate

# 로컬 D1에 적용
wrangler d1 execute cistory-db --local --file=./drizzle/0000_initial.sql

# 프로덕션에 적용
wrangler d1 execute cistory-db --file=./drizzle/0000_initial.sql
```

---

## 7. 개발 서버 실행

```bash
# Next.js 개발 서버 (핫 리로드)
yarn dev

# Cloudflare Workers 환경 테스트
yarn preview
```

---

## 8. 배포

```bash
# 빌드 및 배포
yarn deploy
```

---

## 프로젝트 구조

```
cistory/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── callback/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── page.tsx          # 메인 타임라인
│   │   │   ├── repositories/page.tsx
│   │   │   └── settings/page.tsx
│   │   ├── api/
│   │   │   ├── auth/[...path]/route.ts
│   │   │   ├── repositories/route.ts
│   │   │   ├── timeline/route.ts
│   │   │   ├── sync/route.ts
│   │   │   └── settings/route.ts
│   │   ├── layout.tsx
│   │   └── globals.css
│   │
│   ├── modules/                  # Feature Modules
│   │   ├── auth/
│   │   │   ├── actions.ts
│   │   │   ├── hooks.ts
│   │   │   └── components/
│   │   ├── github/
│   │   │   ├── service.ts
│   │   │   └── types.ts
│   │   ├── sync/
│   │   │   ├── service.ts
│   │   │   └── worker.ts
│   │   ├── summary/
│   │   │   ├── service.ts
│   │   │   └── prompts.ts
│   │   └── timeline/
│   │       ├── components/
│   │       │   ├── Timeline.tsx
│   │       │   ├── CommitCard.tsx
│   │       │   └── Filters.tsx
│   │       └── hooks.ts
│   │
│   ├── lib/
│   │   ├── adapters/             # 외부 서비스 어댑터
│   │   │   ├── vcs/
│   │   │   │   ├── interface.ts  # VCS 인터페이스
│   │   │   │   └── github.ts     # GitHub 구현체
│   │   │   ├── ai/
│   │   │   │   ├── interface.ts  # AI 인터페이스
│   │   │   │   └── claude.ts     # Claude 구현체
│   │   │   └── db/
│   │   │       └── d1.ts         # D1 어댑터
│   │   ├── auth.ts               # Better Auth 설정
│   │   └── utils.ts
│   │
│   ├── components/               # 공용 UI 컴포넌트
│   │   ├── ui/                   # shadcn/ui 컴포넌트
│   │   ├── ThemeToggle.tsx
│   │   └── Layout/
│   │
│   └── db/
│       ├── schema.ts             # Drizzle 스키마
│       ├── index.ts              # DB 클라이언트
│       └── migrations/
│
├── drizzle/                      # 마이그레이션 파일
├── public/
├── wrangler.jsonc
├── drizzle.config.ts
├── next.config.ts
├── open-next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 주요 명령어

| 명령어 | 설명 |
|--------|------|
| `yarn dev` | Next.js 개발 서버 |
| `yarn preview` | Cloudflare Workers 환경 테스트 |
| `yarn build` | 프로덕션 빌드 |
| `yarn deploy` | Cloudflare 배포 |
| `yarn drizzle-kit generate` | 마이그레이션 생성 |
| `yarn drizzle-kit studio` | Drizzle Studio (DB GUI) |

---

## 다음 단계

1. `/speckit.tasks` 실행하여 구현 태스크 생성
2. 태스크 순서대로 구현 진행
3. 각 기능 완료 후 수동 테스트
