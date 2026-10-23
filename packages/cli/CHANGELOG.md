# Changelog

## [0.2.0](https://github.com/amond-ai/agent/compare/amond-v0.1.0...amond-v0.2.0) (2026-10-23)


### ⚠ BREAKING CHANGES

* **agent:** Sandbox.exec, Sandbox.readFileBuffer, and the path-form Sandbox.readFile/writeFile are removed; use run/spawn, readTextFile/readBinaryFile, writeTextFile/writeBinaryFile, or the stream-form readFile/writeFile.

### Features

* **agent:** make Sandbox an AI SDK sandbox session ([#44](https://github.com/amond-ai/agent/issues/44)) ([aac7ee9](https://github.com/amond-ai/agent/commit/aac7ee966ee013f36ae86f92d7cb8a380fda8201))
* **cli:** add the renamed Flue blueprints ([4303407](https://github.com/amond-ai/agent/commit/430340739abcaf2996c19c7f016a9c1209d51a9d))
* **cli:** bundle the renamed Flue docs pages ([c1b3a9b](https://github.com/amond-ai/agent/commit/c1b3a9bedce104ca74512f97b47da09954324b90))
* **cli:** default amond add and update to blueprints.amond.ai ([35458bb](https://github.com/amond-ai/agent/commit/35458bbacd2e008840c0c769b353569316b1091a))
* **cli:** report missing bundled content and add Flue attribution ([#27](https://github.com/amond-ai/agent/issues/27)) ([9cb7ace](https://github.com/amond-ai/agent/commit/9cb7acec126ce336f78dfa6792f30e4132718728))
* **cli:** serve bundled docs pages through amond docs ([fd96052](https://github.com/amond-ai/agent/commit/fd96052ba1c64086e5dfaf0b3c97d1569830e7eb))
* import Flue's runtime, Vite, CLI, SDK and React packages with history ([fc67cdd](https://github.com/amond-ai/agent/commit/fc67cdda133264c38ac8d5ce52198de24e533799))
* rename the imported Flue packages to amond ([#25](https://github.com/amond-ai/agent/issues/25)) ([b6e4652](https://github.com/amond-ai/agent/commit/b6e46524fa2e8882dc3554c15417a89daf6b04f3))


### Bug Fixes

* **agent:** stop the remote command when a live Cloudflare spawn is killed ([#51](https://github.com/amond-ai/agent/issues/51)) ([0e530e7](https://github.com/amond-ai/agent/commit/0e530e7209b1fd65c38499123a3be97f13ae2fe8))
* apply the review suggestions on PR [#33](https://github.com/amond-ai/agent/issues/33) ([ccebf2b](https://github.com/amond-ai/agent/commit/ccebf2b3db34f23844cbc2e2de53898550180ed5))
* apply the review suggestions on PR [#35](https://github.com/amond-ai/agent/issues/35) ([9f3425c](https://github.com/amond-ai/agent/commit/9f3425c4cdbb6d43df179073697e0fa305262d8f))
* **cli:** cache the generated blueprint index with the build output ([52af19a](https://github.com/amond-ai/agent/commit/52af19ae7f7acb4c7b25de5a1ff2c7e42683e5e8))
* **cli:** rebuild on blueprint edits and use shipped blueprints in examples ([44eeb9c](https://github.com/amond-ai/agent/commit/44eeb9cff108425f8941a473858cbec5ab5f8e06))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @amond-ai/agent bumped to 0.2.0
    * @amond-ai/agent-vite bumped to 0.2.0
  * devDependencies
    * @amond-ai/agent-sdk bumped to 0.2.0
