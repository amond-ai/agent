'use agent'

// The smallest agent module: every exported capitalized function is an agent, and the return
// value is its system prompt. Built by src/worker-build.test.ts.
export function IssueTriage() {
  return 'You triage issues. Keep replies short.'
}
