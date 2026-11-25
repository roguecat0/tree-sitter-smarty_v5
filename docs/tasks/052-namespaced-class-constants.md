# 052 — Namespace-qualified class constants

**Status:** complete (2026-11-26); independent review accepted (2026-11-26). Follow-up gap: `true`/`false`/`null` as the first namespace segment (e.g. `{true\x::Y}`) still errors, as for Task 048 calls.
**Type:** standard Smarty syntax gap.
**Dependencies:** 009, 048.

## Motivation and confirmed behavior

Task 048 added `qualified_name` receivers for static method calls and explicitly
left namespaced class constants as a known standard-syntax gap. Smarty 5.8.4
accepts them through the same parser path as unqualified constants:
`value ::= ns1 DOUBLECOLON static_class_access`, where `ns1` is either `ID` or
the lexer's `namespace` token (`TemplateLexer.plex:286`,
`TemplateParser.y:834-853`) and `static_class_access ::= ID`
(`TemplateParser.y:1258`). Neutral examples:

```smarty
{App\Class1::CONSTANT}
{\App\Class1::CONSTANT}
```

Before this task both produced a root `ERROR` containing stray `qualified_name`
and `identifier` nodes. No current application, FBS, HDB or upstream corpus
file contains this form (all roots were already clean); the motivation is
standard-syntax completeness, not a corpus witness.

## Bounded scope and tree contract

Extend `class_constant_expression.class` with the existing `qualified_name`
node used by `static_method_call_expression.class`. Keep the node type, the
`constant: (identifier)` field and anonymous `::` unchanged, so namespaced and
unqualified constants share one shape:

```text
{App\Class1::CONSTANT}
(source_file
  (output
    value: (class_constant_expression
      class: (qualified_name
        (identifier)
        (identifier))
      constant: (identifier))))
```

The qualified receiver follows Task 048 exactly: rooted or unrooted, at least
one segment after a root separator and at least two otherwise, contextual and
digit-prefixed segments, and immediate separators. `::` must be adjacent on
both sides. Constant names use the existing unqualified constant token.

Out of scope and kept visible as gaps: namespaced standalone constants
(`{Demo\Assets\VERSION}`, Smarty-valid), constant access suffixes such as
`->member` (Smarty-valid for unqualified constants too), dynamic receivers and
static properties (`::$name`), and Smarty's digit-leading constant spelling
`::1V` (also unsupported unqualified). `{Demo\Assets::VERSION[0]}` is rejected
by Smarty and remains an error.

## Reference observations (Smarty 5.8.4, 2026-11-26)

`test/reference.php` accepts every valid fixture in
`test/corpus/namespaced-class-constants.txt`. `test/full-engine.php` compiles
rooted, unrooted, one-segment, contextual and digit-prefixed examples without
loading classes, and renders `{\DateTimeInterface::ATOM}` as `Y-m-d\TH:i:sP`
(so the constant is resolved as a class constant, not text). Smarty rejects
`{Demo\Assets ::VERSION}` and `{Demo\Assets:: VERSION}`.

## Failing-first tests

- Trees: `test/corpus/namespaced-class-constants.txt` (output, rooted,
  one-segment, contextual, digit-prefixed, modifier input/arguments, `{if}` /
  `{elseif}` conditions, generic-tag positional/named values, assignment,
  arithmetic precedence, method arguments, bracket index, array key/value,
  foreach source, constant beside call), plus a pinned-source entry in
  `smarty-reference.txt`.
- Node checks: `test/namespaced-class-constants.test.mjs` (reference
  projection, field/range checks, compile-only full engine, recovery with a
  later output, incremental edits including `::CONST` to `::fn()`).
- Mutation: removing `qualified_name` from the constant class choice.

## Contract corrections

Two existing negative assertions encoded the Task 048/009 boundary rather than
Smarty behavior: `{\App\Thing::READY}` in `class-constants.test.mjs`, and the
two class-constant sources in `namespaced-static-method-calls.test.mjs`. Both
already asserted that Smarty accepts the input. They now assert a
`class_constant_expression` with a `qualified_name` class (and still no static
call). The standalone `{Demo\Assets\VERSION}` assertion stays an error.

## Implementation evidence

`grammar.js` adds `$.qualified_name` as the first choice of
`class_constant_expression.class`; no new node type, field or conflict was
introduced and `tree-sitter generate` reports no new conflicts. The static
call (prec 9) still wins when `(` follows the same receiver; the constant
(prec 8) applies otherwise.

Acceptance: `npm test` passed with 485/485 Tree-sitter corpus cases, 638/638
Node tests, and 25/25 isolated mutations caught, including the new
"qualified namespace receiver is no longer a class constant" mutation (fixture
`Namespaced constant beside namespaced call`). The Task 048 mutation anchor was
widened with its `prec(9, ...)` prefix because the same `class` choice text now
appears in both rules; its fault is unchanged and still caught.

Recorder projections match every valid fixture. Full-engine compile accepts the
rooted/unrooted/one-segment/contextual/digit-prefixed, condition, arithmetic and
modifier-argument examples; `{\DateTimeInterface::ATOM|lower}` renders
`y-m-d\th:i:sp`. Malformed separator/`::` spacing, empty constant, single or
triple colon, and `::VERSION[0]` all keep a separate later `{$after}` output
and never produce a static call. Fresh and incremental snapshots match for
`Thing::READY` → `Demo\Thing::READY` → `Demo\Thing::ready()` (constant to call)
→ broken `(` → constant → `:` break → rooted → `\\` break → unqualified.

Hash-matched corpus reports (grammar `bd8f6ad45da3…` before, `2998bc001853…`
after; all file hashes identical per root), saved in the session scratchpad:

| Separate corpus root | Before | After |
| --- | ---: | ---: |
| Fixed `corpus/application/` | 467 clean / 467 | 467 clean / 467 |
| Upstream Smarty core | 33 / 33 | 33 / 33 |
| Upstream Smarty demo | 1 / 1 | 1 / 1 |
| FBS (`../b3-app/fbs`) | 202 / 202 | 202 / 202 |
| HDB (`../b3-app/hdb`) | 474 / 474 | 474 / 474 |

A scan of all five roots found zero qualified class constants after the change,
so no corpus tree changed through this rule; the task is not credited with any
corpus gain. Editor queries were not changed: as for Task 048 static calls, the
`class_constant_expression class: (identifier) @type` capture does not match a
`qualified_name` class, so qualified receivers fall back to generic highlighting.
