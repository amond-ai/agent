import pleaseai from '@pleaseai/eslint-config'
import { sharedRules } from './eslint.rules'

export default pleaseai({
  type: 'app',
  ignores: [
    '**/dist',
    '**/node_modules',
    '**/coverage',
    // Wrangler state the Worker build test writes into its fixture.
    '**/.wrangler',
    'vendor/**',
    // Written by the CLI's prebuild from blueprints/ and gitignored.
    'packages/cli/src/generated/**',
    // Code samples in the bundled docs pages are fragments (elided bodies, mixed languages) in
    // Flue's own style; the pages teach, they do not compile. Prose is still linted.
    'packages/cli/docs/**/*.md/**',
  ],
}, {
  rules: sharedRules,
}, {
  // The five packages imported from Flue (ADR-0004). They were written for Biome, which relaxed
  // several rules; the rules below are off because autofix cannot satisfy them and satisfying
  // them by hand would mean rewriting Flue's logic. Reformatting is autofix only.
  files: [
    'packages/agent/**',
    'packages/agent-vite/**',
    'packages/cli/**',
    'packages/agent-sdk/**',
    'packages/agent-react/**',
  ],
  rules: {
    // Reordering moves side-effect imports (`import 'virtual:amond/providers'`) and the imports
    // around them, changing module evaluation order; leave Flue's import order as written.
    'perfectionist/sort-imports': 'off',
    // These autofixes change runtime behaviour, not just layout: a different thrown error class,
    // a different re-export or import evaluation order, a rewritten expression or regex. The
    // reformat commit must stay mechanical, so leave the code as Flue wrote it.
    'unicorn/prefer-type-error': 'off',
    'unicorn/prefer-number-properties': 'off',
    'unicorn/prefer-string-starts-ends-with': 'off',
    'unicorn/no-new-array': 'off',
    'e18e/prefer-timer-args': 'off',
    'antfu/top-level-function': 'off',
    'perfectionist/sort-exports': 'off',
    'import/first': 'off',
    'regexp/use-ignore-case': 'off',
    'regexp/prefer-w': 'off',
    'regexp/prefer-d': 'off',
    'regexp/optimal-quantifier-concatenation': 'off',
    // Flue writes `if (x) return y` on one line; no autofix, 1089 hits.
    'style/max-statements-per-line': 'off',
    // Tabs remain only inside template literals (SQL, generated worker code) and comments, whose
    // text must not change.
    'style/no-tabs': 'off',
    'style/no-mixed-spaces-and-tabs': 'off',
    // Trailing whitespace sits inside a JSDoc/template body that autofix leaves alone.
    'style/no-trailing-spaces': 'off',
    // Fights style/indent on multi-line ternaries and has no stable autofix.
    'style/operator-linebreak': 'off',
    // Mirrors Biome's noExplicitAny/noConsole/noNonNullAssertion relaxations: Flue logs through
    // console in its runtime and dev server.
    'no-console': 'off',
    // Functions and consts are hoisted by design in Flue's modules; reordering is a code move.
    'ts/no-use-before-define': 'off',
    // Flue's bootstrap files run in bundles where `process` is a global; adding imports changes
    // generated entry code.
    'node/prefer-global/process': 'off',
    // The generated Node entry awaits at module top level on purpose.
    'antfu/no-top-level-await': 'off',
    // Fixing these changes logic (loops, switch fallthrough, aliases) rather than style.
    'no-fallthrough': 'off',
    'no-unmodified-loop-condition': 'off',
    'no-new': 'off',
    'prefer-const': 'off',
    'ts/no-this-alias': 'off',
    'unused-imports/no-unused-vars': 'off',
    'e18e/prefer-url-canparse': 'off',
    // Declaration-file and JSDoc conventions Flue's public types rely on.
    'ts/method-signature-style': 'off',
    'jsdoc/check-param-names': 'off',
    // Regex rewrites change parsing behaviour; flagged for review instead of edited.
    'regexp/no-super-linear-backtracking': 'off',
    'regexp/no-unused-capturing-group': 'off',
  },
})
