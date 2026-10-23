# Changelog

## [0.2.0](https://github.com/amond-ai/agent/compare/agent-v0.1.0...agent-v0.2.0) (2026-10-23)


### ⚠ BREAKING CHANGES

* **agent:** Sandbox.exec, Sandbox.readFileBuffer, and the path-form Sandbox.readFile/writeFile are removed; use run/spawn, readTextFile/readBinaryFile, writeTextFile/writeBinaryFile, or the stream-form readFile/writeFile.

### Features

* **agent:** make Sandbox an AI SDK sandbox session ([#44](https://github.com/amond-ai/agent/issues/44)) ([aac7ee9](https://github.com/amond-ai/agent/commit/aac7ee966ee013f36ae86f92d7cb8a380fda8201))
* **cli:** report missing bundled content and add Flue attribution ([#27](https://github.com/amond-ai/agent/issues/27)) ([9cb7ace](https://github.com/amond-ai/agent/commit/9cb7acec126ce336f78dfa6792f30e4132718728))
* import Flue's runtime, Vite, CLI, SDK and React packages with history ([fc67cdd](https://github.com/amond-ai/agent/commit/fc67cdda133264c38ac8d5ce52198de24e533799))
* rename the imported Flue packages to amond ([#25](https://github.com/amond-ai/agent/issues/25)) ([b6e4652](https://github.com/amond-ai/agent/commit/b6e46524fa2e8882dc3554c15417a89daf6b04f3))


### Bug Fixes

* **agent:** stop the remote command when a live Cloudflare spawn is killed ([#51](https://github.com/amond-ai/agent/issues/51)) ([0e530e7](https://github.com/amond-ai/agent/commit/0e530e7209b1fd65c38499123a3be97f13ae2fe8))
