# Repository Guidelines

## Project Structure & Module Organization

Application code lives in `src/`. Next.js App Router pages, layouts, and API handlers are in
`src/app`; reusable UI is in `src/components`; feature-specific code is grouped under
`src/modules`. Shared integrations and
utilities belong in `src/lib`, while Drizzle database access and schema definitions are in
`src/db`. Generated migrations live in `drizzle/`, static files in `public/`, operational scripts
in `scripts/`, and longer design or deployment notes in `docs/`.

## Build, Test, and Development Commands

Use Node.js 24.20.0 or a newer Node.js 24 release and Yarn 4.5.0, as specified in `package.json`. Install dependencies with
`yarn install`.

- `yarn dev` starts the Turbopack development server on `localhost:3000`.
- `yarn build` creates a production Next.js build; `yarn start` serves it.
- `yarn lint` checks `src/` with Biome; `yarn check` applies safe lint and formatting fixes.
- `yarn test` runs the Vitest suite once; `yarn test:watch` reruns affected tests interactively.
- `yarn test:integration` starts Docker PostgreSQL, applies migrations, and runs integration
  tests. Docker must be running; stop the database afterward with `yarn db:test:down`.
- `yarn db:generate` creates Drizzle migrations after schema changes; `yarn db:migrate` applies
  pending migrations. Review generated SQL before committing it.

## Coding Style & Naming Conventions

TypeScript runs in strict mode. Biome enforces 2-space indentation, 100-character lines, double
quotes, semicolons, trailing commas where valid in ES5, organized imports, and type-only imports.
Use PascalCase for React components (`LocationMap.tsx`), `useCamelCase` for hooks, camelCase for
functions and variables, and Next.js conventions such as `page.tsx` and `route.ts`. Prefer the
`@/` alias for imports from `src`.

## Testing Guidelines

Vitest runs in a Node environment and discovers `*.test.ts` and `*.spec.ts` in `src/` and
`scripts/`. Colocate tests with the implementation, such as `parser.test.ts` or `route.test.ts`.
The default suite requires no live database; `src/**/*.integration.test.ts` runs separately
against test PostgreSQL. Use only a disposable test database for `TEST_DATABASE_URL`.
Add focused regression tests for bug fixes, especially authorization, parsers, and calculations.
Run `yarn test`, `yarn lint`, and `yarn build` before opening a pull request; also run
`yarn test:integration` for database changes. No numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects: `fix:`, `feat:`, `chore(deps):`, and
`docs:`. Write imperative, concise subjects and keep
each commit focused. Pull requests should explain the problem and solution, call out configuration
or migration changes, link relevant issues, and include screenshots for visible UI changes. List
the validation commands run and never commit `.env` values or credentials; update `.env.example`
when introducing configuration.
