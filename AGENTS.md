# Repository Guidelines

## Project Structure & Module Organization

Application code lives in `src/`. Next.js App Router pages, layouts, and API handlers are in
`src/app`; reusable UI is in `src/components`; feature-specific code is grouped under
`src/modules` (for example, `location`, `portfolio`, and `spending`). Shared integrations and
utilities belong in `src/lib`, while Drizzle database access and schema definitions are in
`src/db`. Generated migrations live in `drizzle/`, static files in `public/`, operational scripts
in `scripts/`, and longer design or deployment notes in `docs/`.

## Build, Test, and Development Commands

Use Yarn 4, as pinned in `package.json`.

- `yarn dev` starts the Turbopack development server on `localhost:3000`.
- `yarn build` creates a production Next.js build; `yarn start` serves it.
- `yarn lint` checks `src/` with Biome; `yarn check` applies safe lint and formatting fixes.
- `yarn test` runs the Vitest suite once; `yarn test:watch` reruns affected tests interactively.
- `yarn db:generate` creates Drizzle migrations after schema changes; `yarn db:migrate` applies
  pending migrations. Review generated SQL before committing it.

## Coding Style & Naming Conventions

TypeScript runs in strict mode. Biome enforces 2-space indentation, 100-character lines, double
quotes, semicolons, trailing commas where valid in ES5, organized imports, and type-only imports.
Use PascalCase for React components (`LocationMap.tsx`), `useCamelCase` for hooks, camelCase for
functions and variables, and Next.js conventions such as `page.tsx` and `route.ts`. Prefer the
`@/` alias for imports from `src`. Keep feature logic inside its module and shared infrastructure
inside `src/lib`.

## Testing Guidelines

Vitest runs in a Node environment and discovers `src/**/*.{test,spec}.ts`. Colocate tests with the
implementation, following names such as `parser.test.ts` or `route.test.ts`. Add focused regression
tests for bug fixes, especially parsers, route authorization, calculations, and location analysis.
Run `yarn test`, `yarn lint`, and `yarn build` before opening a pull request. No numeric coverage
threshold is configured; prioritize meaningful branch and edge-case coverage.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit-style subjects: `fix:`, `feat:`, `test:`, `perf:`,
`docs:`, and scoped forms such as `fix(security):`. Write imperative, concise subjects and keep
each commit focused. Pull requests should explain the problem and solution, call out configuration
or migration changes, link relevant issues, and include screenshots for visible UI changes. List
the validation commands run and never commit `.env` values or credentials; update `.env.example`
when introducing configuration.
