# pricing-formula-lexer-parser-evaluator

Build a small pricing-formula language in TypeScript, from scratch, as a pipeline
of pure functions: **lexer → parser → validator → evaluator**. Formulas are
user-written and set prices, so they are *interpreted*, never executed as JS.

Mau writes the implementation. Claude coaches and reviews.

## Project-specific coaching rules

On top of the repo-wide rules in the root `CLAUDE.md`:

- **Tests are the spec.** Claude *may* write the test files and fixtures for each
  milestone. Mau codes against them. A milestone is done when its tests pass.
- **Snippets ≤10 lines**, illustrative only. They never contain the actual solution.
- **"Just write it"**: if Mau asks for this, check that he really means it before
  writing any implementation.
- **Quiz along the way** on: why precedence falls out of the grammar layering, why
  the parser should never throw, and why the AST is kept separate from evaluation.

## Constraints

- Plain TypeScript (`strict`) + a test runner (Vitest or Jest; see M1).
- No runtime dependencies. No expression-parsing libraries.
- **Never `eval` or `new Function`.**

## The language

Every variable has a name, a min, and a max. It is referenced with an `@` prefix.

```
IF (@RATEPERSIDE < 65)
THEN @PUMPINGHOURS * ((10695.27 + 435)/2) ELSE 0,

IF (@RATEPERSIDE < 70) AND (@RATEPERSIDE >= 65)
THEN @PUMPINGHOURS * ((10695.27 + 480)/2) ELSE 0,

IF (@RATEPERSIDE >= 70)
THEN @PUMPINGHOURS * ((10695.27 + 525)/2) ELSE 0
```

A program is a list of statements separated by commas. **Every statement is
evaluated and the results are summed.** Statements that don't match should give 0
(through `ELSE 0`).

Acceptance fixture: `@PUMPINGHOURS = 2.5`, `@RATEPERSIDE = 72` → **14025.3375**
(only the third statement matches).

### Grammar

```
program    := statement (',' statement)*
statement  := ifStmt | expr
ifStmt     := IF condition THEN expr (ELSE IF condition THEN expr)* ELSE expr
condition  := andCond (OR andCond)*
andCond    := comparison (AND comparison)*
comparison := expr ('<' | '<=' | '>' | '>=' | '=' | '!=') expr
            | '(' condition ')'
expr       := term (('+' | '-') term)*
term       := factor (('*' | '/') factor)*
factor     := NUMBER | VARIABLE | '(' expr ')' | '-' factor
VARIABLE   := '@' [A-Z_][A-Z0-9_]*
```

Open design fork (M3, Mau's call): `(` can start either a parenthesized
condition or a parenthesized arithmetic expression. Options to reason through:
backtracking, lookahead, or parsing a comparison and then checking.

### Rules

- `ELSE` is **required**. A missing one is an error.
- `ELSE IF` chains are allowed. There is no nested `IF` inside a `THEN`/`ELSE` expression.
- Keywords (`IF THEN ELSE AND OR`) are case-insensitive. Variable names are uppercase.
- `=` is equality. There is no `==`.
- Newlines and whitespace are insignificant. Only commas separate statements.
- Min/max is enforced at evaluation time. A sample value outside the range is an
  error. It is never clamped.

## Architecture

```
source → lex() → Token[] → parse() → AST → validate(ast, variables) → evaluate(ast, values)
```

Suggested files: `tokens.ts`, `lexer.ts`, `ast.ts`, `parser.ts`, `validate.ts`,
`evaluate.ts`, `diagnostics.ts`, plus tests.

- **The AST is a discriminated union** on `kind`: `'Program' | 'If' | 'Binary' |
  'Logical' | 'Compare' | 'Unary' | 'Number' | 'Var'`. The validator and evaluator
  walk it with `switch (node.kind)`, and the compiler checks exhaustiveness through
  `never`. This is the Visitor pattern written idiomatically, without classes.
- **Hand-written recursive descent parser**: one function per grammar rule, so the
  code reads like the grammar.
- **Never throw for user errors.** Every stage returns `{ result, diagnostics }`:
  ```ts
  type Diagnostic = { severity: 'error' | 'warning'; code: string; message: string; start: number; end: number };
  ```
  Every token and node carries `start`/`end` source offsets, so a UI can underline
  the error and show "line 3, col 5".
- **Collect multiple errors.** After a syntax error the parser resyncs at the next
  `,` and keeps going.
- **Per-statement breakdown** from the evaluator:
  `{ total, statements: [{ value, matchedBranch }] }`. Because statements are
  summed, this is what makes a formula debuggable.

## Diagnostics (each needs a test)

| Stage | Code | Example |
|---|---|---|
| lex | `UNEXPECTED_CHAR` | `@A # 2` |
| lex | `BAD_NUMBER` | `1.2.3` |
| lex | `EMPTY_VARIABLE` | `@ + 1` |
| parse | `EXPECTED_THEN` | `IF @A > 1 @A ELSE 0` |
| parse | `MISSING_ELSE` | `IF @A > 1 THEN 5` |
| parse | `UNBALANCED_PAREN` | `(@A + 1` |
| parse | `DANGLING_OPERATOR` | `@A * ` |
| parse | `CONDITION_EXPECTED` | `IF @A THEN 1 ELSE 0` (no comparison) |
| parse | `EMPTY_STATEMENT` | `@A, , @B` or a trailing comma |
| validate | `UNKNOWN_VARIABLE` | `@RATE` when only `@RATEPERSIDE` exists → suggest the closest name |
| validate | `MISSING_AT_PREFIX` | bare `PUMPINGHOURS` that matches a defined variable → "did you mean `@PUMPINGHOURS`?" |
| validate | `UNUSED_VARIABLE` (warning) | a defined variable is never referenced |
| validate | `INVALID_VARIABLE_DEF` | min > max, duplicate name, or a name that isn't `[A-Z_][A-Z0-9_]*` |
| evaluate | `OUT_OF_RANGE` | sample value outside the variable's min/max |
| evaluate | `DIVISION_BY_ZERO` | `@A / 0` |
| evaluate | `MISSING_VALUE` | a referenced variable has no sample value |

Parked hint. Give it **only when Mau asks**: `MISSING_AT_PREFIX` needs the lexer
to emit an `IDENTIFIER` token for bare words that aren't keywords, rather than
rejecting them, so the validator can produce the helpful message.

## Exercises

- ⬜ **M1 — Tokens + lexer.** First pick the test runner (Vitest or Jest), then
  Claude hands over the M1 test file. Teaches: tokens with `start`/`end` positions,
  case-insensitive keywords, int/decimal numbers, `@` variables, one- vs
  two-character operators (`<=`, `>=`, `!=`), lexer diagnostics.
- ⬜ **M2 — AST + expression parser.** Arithmetic only. Teaches: recursive
  descent, precedence and left-associativity from grammar layering
  (`2 - 3 - 4 = -5`, `2 + 3 * 4 = 14`), unary minus, parentheses.
- ⬜ **M3 — Conditions + IF / ELSE IF / ELSE + comma-separated program.**
  Teaches: boolean precedence (`AND` over `OR`), and resolving the `(`
  ambiguity (the design fork above).
- ⬜ **M4 — Error recovery.** Teaches: panic-mode resync at `,`, reporting
  several syntax errors from one source without throwing.
- ⬜ **M5 — Validator.** Teaches: variable definitions, semantic checks as a
  second AST walk, exhaustive `switch` + `never`, "did you mean" suggestions with
  Levenshtein distance ≤ 2.
- ⬜ **M6 — Evaluator.** Teaches: interpreting the AST, per-statement breakdown,
  range checks, division by zero. The acceptance fixture must give 14025.3375.
- ⬜ **M7 — Pretty-printer (optional).** AST → normalized source. Teaches: the
  round-trip property `parse(print(ast))` ≡ `ast`, and minimal parenthesization.
- ⬜ **M8 — Minimal UI (optional).** Textarea + variables table + error list +
  a test panel with each statement's value and the total.

## Failures

*symptom → cause → fix. Record bugs as they happen.*

(none yet)

## Learnings

*concepts that stuck, in plain words, for a cold reader.*

(none yet)
