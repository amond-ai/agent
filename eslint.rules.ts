import type { Rules } from '@pleaseai/eslint-config'

/**
 * Rule overrides shared by every eslint.config.ts in the monorepo, kept in one object so the
 * configs cannot drift apart as the workspace grows.
 */
export const sharedRules: Rules = {
  // The default (allowWhitespace: false) reads a line-leading `*emphasis*` as a doubled
  // asterisk and its autofix strips the opening `*`, corrupting intentional JSDoc emphasis on
  // every `lint:fix` run. allowWhitespace checks the delimiter-adjacent run only, which still
  // catches delimiter-adjacent `** text` typos and multi-line `**\/` endings.
  'jsdoc/no-multi-asterisks': ['warn', { allowWhitespace: true }],
}
