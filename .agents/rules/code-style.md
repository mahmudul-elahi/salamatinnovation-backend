# Code Style & Communication Rules

## No Emojis Policy (STRICT)
- **Zero Emojis**: Never include emojis in source code, console logs, comments, terminal outputs, seed scripts, commit messages, documentation, or conversation responses.
- **Log Formatting**: Use plain text prefixes for status and logging, such as:
  - `[INFO]`
  - `[WARN]`
  - `[ERROR]`
  - `[SEED]`
  - `[OK]`
  - `[DONE]`

## Formatting & Naming
- **Clean Technical Output**: Maintain a clean, professional, concise engineering tone without decorative symbols or conversational fluff.
- **File Names**: kebab-case for filenames and folders (e.g. `roles.seed.ts`, `prisma.service.ts`).
- **Test Files**: unit specs are named `<source-file>.spec.ts` and placed in `test/unit/` at the path mirroring the source file under `src/`; e2e specs are named `<feature>.e2e-spec.ts` in `test/`.
- **Imports**: ESM imports ending with `.js` extension for local relative paths. Specs import the code under test from `src/` via relative paths (e.g. `../../../../../src/modules/auth/services/token.service.js`).
