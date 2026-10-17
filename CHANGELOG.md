## [1.10.3](https://github.com/Favourorg/Stellar-forge/compare/v1.10.2...v1.10.3) (2026-09-21)


### Bug Fixes

* **deps:** patch high-severity npm advisories in frontend ([31bc0b2](https://github.com/Favourorg/Stellar-forge/commit/31bc0b2308e10c48bf0ea9d6feaf4bdd29eda6fe)), closes [hi#severity](https://github.com/hi/issues/severity)

## [1.10.2](https://github.com/Favourorg/Stellar-forge/compare/v1.10.1...v1.10.2) (2026-09-21)


### Bug Fixes

* **api:** record pin owner in memory when the KV write fails ([06e3d27](https://github.com/Favourorg/Stellar-forge/commit/06e3d2729aa1fd95db9fb56de795bf3677838f29))

## [1.10.1](https://github.com/Favourorg/Stellar-forge/compare/v1.10.0...v1.10.1) (2026-09-21)


### Bug Fixes

* **scripts:** make stellar-impl ABI check count arguments exactly ([94ff7c7](https://github.com/Favourorg/Stellar-forge/commit/94ff7c78f7ab34b6c0b58f597cd4eefa9abbc537))

# [1.10.0](https://github.com/Favourorg/Stellar-forge/compare/v1.9.3...v1.10.0) (2026-09-21)


### Features

* enhance env validation error screen with improved UI and helpful links ([#1182](https://github.com/Favourorg/Stellar-forge/issues/1182)) ([59c0a33](https://github.com/Favourorg/Stellar-forge/commit/59c0a3348165a6b9e72293f716bb6bb97fa694d8))

## [1.9.3](https://github.com/Favourorg/Stellar-forge/compare/v1.9.2...v1.9.3) (2026-08-29)


### Bug Fixes

* **ci:** run the frontend job on Node 22 so jsdom 30 can load ([a414443](https://github.com/Favourorg/Stellar-forge/commit/a414443f4bbf8797b5c6ccbfe99285a824810de2))

## [1.9.2](https://github.com/Favourorg/Stellar-forge/compare/v1.9.1...v1.9.2) (2026-08-29)


### Bug Fixes

* **ci:** repair invalid YAML that stopped the access-control drift workflow running ([9845fea](https://github.com/Favourorg/Stellar-forge/commit/9845fea078cd926cd9c78288e776f7d132b180d7)), closes [#1112](https://github.com/Favourorg/Stellar-forge/issues/1112)

## [1.9.1](https://github.com/Favourorg/Stellar-forge/compare/v1.9.0...v1.9.1) (2026-08-29)


### Bug Fixes

* **api:** repair unreachable rate-limit fallback and correct clientIp XFF direction ([d99fb61](https://github.com/Favourorg/Stellar-forge/commit/d99fb61a74d88719502af5b222deec9dbb6cd7cc)), closes [pre-#1162](https://github.com/pre-/issues/1162) [#1114](https://github.com/Favourorg/Stellar-forge/issues/1114) [#1162](https://github.com/Favourorg/Stellar-forge/issues/1162) [#1114](https://github.com/Favourorg/Stellar-forge/issues/1114) [#1162](https://github.com/Favourorg/Stellar-forge/issues/1162)
* **contract:** restore the upgrade event tests on soroban-sdk 27 ([dde4ea3](https://github.com/Favourorg/Stellar-forge/commit/dde4ea3594a7d17a07e716cb6ed7ada25078b8b6))
* **frontend:** decode the two-step upgrade events dropped by CONTRACT_TOPIC_MAP ([0d2d3ec](https://github.com/Favourorg/Stellar-forge/commit/0d2d3ec066aa086d27fea344003565e8e8020543))

# [1.9.0](https://github.com/Favourorg/Stellar-forge/compare/v1.8.7...v1.9.0) (2026-08-28)


### Features

* **api:** expose rate-limiter durability via isRateLimitDurable and health endpoint ([#1181](https://github.com/Favourorg/Stellar-forge/issues/1181)) ([389a483](https://github.com/Favourorg/Stellar-forge/commit/389a48371d274711121de0877972cc1fecc66bcc)), closes [#14](https://github.com/Favourorg/Stellar-forge/issues/14)

## [1.8.7](https://github.com/Favourorg/Stellar-forge/compare/v1.8.6...v1.8.7) (2026-08-28)


### Bug Fixes

* **auth:** replace timing-unsafe JWT signature comparison with timingSafeEqual ([#1179](https://github.com/Favourorg/Stellar-forge/issues/1179)) ([8925440](https://github.com/Favourorg/Stellar-forge/commit/89254401d71ae83a0d5c945b899ac443822c7204)), closes [#4](https://github.com/Favourorg/Stellar-forge/issues/4)
* **contract:** replace single-step upgrade with two-step timelock (issue [#6](https://github.com/Favourorg/Stellar-forge/issues/6)) ([#1180](https://github.com/Favourorg/Stellar-forge/issues/1180)) ([cb9f98a](https://github.com/Favourorg/Stellar-forge/commit/cb9f98ad758de875ee9fa93f00991982bcd4ab77))
* split rate-limit buckets, guard cross-tab network change, enforce error discriminant uniqueness ([#1178](https://github.com/Favourorg/Stellar-forge/issues/1178)) ([7ddf2c4](https://github.com/Favourorg/Stellar-forge/commit/7ddf2c4d1836ed65bb5088a172ed72df9015775e)), closes [#1162](https://github.com/Favourorg/Stellar-forge/issues/1162) [#1163](https://github.com/Favourorg/Stellar-forge/issues/1163) [#1164](https://github.com/Favourorg/Stellar-forge/issues/1164) [#1162](https://github.com/Favourorg/Stellar-forge/issues/1162) [#1163](https://github.com/Favourorg/Stellar-forge/issues/1163) [#1164](https://github.com/Favourorg/Stellar-forge/issues/1164)

## [1.8.6](https://github.com/Favourorg/Stellar-forge/compare/v1.8.5...v1.8.6) (2026-08-25)


### Bug Fixes

* **contract:** signal incomplete rotation from legacy admin aliases ([#1159](https://github.com/Favourorg/Stellar-forge/issues/1159)) ([#1175](https://github.com/Favourorg/Stellar-forge/issues/1175)) ([6dcaf07](https://github.com/Favourorg/Stellar-forge/commit/6dcaf07f2fa8b41c5e052d1bd0b433cc8aac8562))

## [1.8.5](https://github.com/Favourorg/Stellar-forge/compare/v1.8.4...v1.8.5) (2026-08-25)


### Bug Fixes

* **frontend:** whitelist the real mainnet Soroban RPC host in CSP ([#1174](https://github.com/Favourorg/Stellar-forge/issues/1174)) ([d5f2ad1](https://github.com/Favourorg/Stellar-forge/commit/d5f2ad108a52c5e4748e7b8625270dcbac4d9057))

## [1.8.4](https://github.com/Favourorg/Stellar-forge/compare/v1.8.3...v1.8.4) (2026-08-25)


### Bug Fixes

* **api:** stop pin reconciliation mass-unpinning referenced metadata ([#1173](https://github.com/Favourorg/Stellar-forge/issues/1173)) ([d2a122a](https://github.com/Favourorg/Stellar-forge/commit/d2a122a411ef6eb00947467a60ac2b4d94a783e1)), closes [#1156](https://github.com/Favourorg/Stellar-forge/issues/1156)

## [1.8.3](https://github.com/Favourorg/Stellar-forge/compare/v1.8.2...v1.8.3) (2026-08-25)


### Bug Fixes

* **api:** require CID ownership to unpin IPFS content (IDOR) ([#1172](https://github.com/Favourorg/Stellar-forge/issues/1172)) ([70fd048](https://github.com/Favourorg/Stellar-forge/commit/70fd0485df0f58e8ea9d7ff3eec3af2036c76d95)), closes [#1155](https://github.com/Favourorg/Stellar-forge/issues/1155) [#1049](https://github.com/Favourorg/Stellar-forge/issues/1049)

## [1.8.2](https://github.com/Favourorg/Stellar-forge/compare/v1.8.1...v1.8.2) (2026-08-25)

### Bug Fixes

- **ci:** resolve access-control workflow triggers, ipfs cid validation, and test suites drift ([#1171](https://github.com/Favourorg/Stellar-forge/issues/1171)) ([da7930d](https://github.com/Favourorg/Stellar-forge/commit/da7930d89f1cf303038c4c35010316ca8c211614))

# 1.0.0 (2026-08-24)

## [1.8.1](https://github.com/Favourorg/Stellar-forge/compare/v1.8.0...v1.8.1) (2026-08-25)

### Bug Fixes

- [#741](https://github.com/ignaciojulio/Stellar-forge/issues/741) AdminPanel restricted to admin address only ([7b2b8c2](https://github.com/ignaciojulio/Stellar-forge/commit/7b2b8c23d40955b39ea300acea24cfeef851d32d))
- **#1024,#1023:** fee-split edge cases and metadata URI validation ([#1036](https://github.com/ignaciojulio/Stellar-forge/issues/1036)) ([e3174cb](https://github.com/ignaciojulio/Stellar-forge/commit/e3174cb0bde98950c3bf7be8b97beb16a8cd8113)), closes [#1024](https://github.com/ignaciojulio/Stellar-forge/issues/1024) [#1023](https://github.com/ignaciojulio/Stellar-forge/issues/1023) [#1024](https://github.com/ignaciojulio/Stellar-forge/issues/1024) [#1023](https://github.com/ignaciojulio/Stellar-forge/issues/1023)
- **#1024,#1023:** fee-split edge cases and metadata URI validation ([#1037](https://github.com/ignaciojulio/Stellar-forge/issues/1037)) ([116d025](https://github.com/ignaciojulio/Stellar-forge/commit/116d0258ba1a58cfb22f5a12de9107b00e0323d5)), closes [#1024](https://github.com/ignaciojulio/Stellar-forge/issues/1024) [#1023](https://github.com/ignaciojulio/Stellar-forge/issues/1023) [#1024](https://github.com/ignaciojulio/Stellar-forge/issues/1024) [#1023](https://github.com/ignaciojulio/Stellar-forge/issues/1023)
- **#854:** format useTransactionHistory.ts to match project Prettier style (remove semicolons) ([8e7b12b](https://github.com/ignaciojulio/Stellar-forge/commit/8e7b12b757780a3570ec5b425ba61bcf4a23d6b1)), closes [#854](https://github.com/ignaciojulio/Stellar-forge/issues/854)
- **#855:** eliminate CSP duplication by generating index.html meta tag from policy.ts ([1dc325a](https://github.com/ignaciojulio/Stellar-forge/commit/1dc325a503f0f41eb78e5220e1252b4afcb5ee13)), closes [#855](https://github.com/ignaciojulio/Stellar-forge/issues/855)
- **#932:** consolidate useTransactionPolling into useTransaction.ts ([#956](https://github.com/ignaciojulio/Stellar-forge/issues/956)) ([28a84b6](https://github.com/ignaciojulio/Stellar-forge/commit/28a84b67df80e8f6c155e97da6f54704a36113cb)), closes [#932](https://github.com/ignaciojulio/Stellar-forge/issues/932) [#932](https://github.com/ignaciojulio/Stellar-forge/issues/932)
- **#944:** add txHash, network, contractId Sentry tagging on transaction failures ([#952](https://github.com/ignaciojulio/Stellar-forge/issues/952)) ([9c213d0](https://github.com/ignaciojulio/Stellar-forge/commit/9c213d09b089f5704d2748ccc7e3aa2b4fc18a15)), closes [#944](https://github.com/ignaciojulio/Stellar-forge/issues/944) [#944](https://github.com/ignaciojulio/Stellar-forge/issues/944)
- **#945:** document batch resource limits and add frontend size cap ([#953](https://github.com/ignaciojulio/Stellar-forge/issues/953)) ([8555f65](https://github.com/ignaciojulio/Stellar-forge/commit/8555f65acc16ff60cd3108eb533d836ca7fcd0f2)), closes [#945](https://github.com/ignaciojulio/Stellar-forge/issues/945) [#945](https://github.com/ignaciojulio/Stellar-forge/issues/945)
- **#947:** add incident response runbook and break-glass recovery docs ([#954](https://github.com/ignaciojulio/Stellar-forge/issues/954)) ([0546342](https://github.com/ignaciojulio/Stellar-forge/commit/054634208dd995ce8daacbd83199c6c8e3547c2a)), closes [#947](https://github.com/ignaciojulio/Stellar-forge/issues/947) [#9](https://github.com/ignaciojulio/Stellar-forge/issues/9) [#947](https://github.com/ignaciojulio/Stellar-forge/issues/947)
- accept decimals=0 in validateTokenParams ([56cb8d9](https://github.com/ignaciojulio/Stellar-forge/commit/56cb8d961c2d5e421f5391b6d31587ad52013d4b))
- add bounds validation to token metadata type guard (CWE-1236) ([#964](https://github.com/ignaciojulio/Stellar-forge/issues/964)) ([ab4cb5c](https://github.com/ignaciojulio/Stellar-forge/commit/ab4cb5c31ea6ded2673ee8d4dc61d11f2469d5a7))
- add BurnAmountExceedsBalance check in burn function ([1113068](https://github.com/ignaciojulio/Stellar-forge/commit/1113068ceb02e464c40066021ca24279dc4753ab))
- add CI drift check for contract ABI documentation - Closes [#946](https://github.com/ignaciojulio/Stellar-forge/issues/946) ([#949](https://github.com/ignaciojulio/Stellar-forge/issues/949)) ([8e67454](https://github.com/ignaciojulio/Stellar-forge/commit/8e67454a4a4d41c8fe1232eb0d2faebce79f9c6d))
- add env var validation and misconfiguration screen ([f66f1d5](https://github.com/ignaciojulio/Stellar-forge/commit/f66f1d5c144e9e96ddb451e4feeffca41e950b3d))
- add esbuild as a direct devDependency for Storybook CI build ([512b11e](https://github.com/ignaciojulio/Stellar-forge/commit/512b11e8cad65979e4fbbdac073ddb8dc5ba1fa8))
- add formula-injection guard to CSV export (CWE-1236) ([#963](https://github.com/ignaciojulio/Stellar-forge/issues/963)) ([bff7012](https://github.com/ignaciojulio/Stellar-forge/commit/bff70125f81172ece961c8c4f9f2a215e6f746ce))
- add missing build step to E2E job, fix sitemap script crash ([535955c](https://github.com/ignaciojulio/Stellar-forge/commit/535955c34bbd6b3877fde7f5a29b42288352cdcc))
- add missing imports for mobile responsive components ([0b89740](https://github.com/ignaciojulio/Stellar-forge/commit/0b89740d64d35bfacddd14b8c6b5a7c4933a4c7b))
- add standalone network support and fix E2E test mocks ([a78f8de](https://github.com/ignaciojulio/Stellar-forge/commit/a78f8deef5c21e74f3b391726a60636692a242c3))
- align adm_upd topic and add CI drift detection ([#1032](https://github.com/ignaciojulio/Stellar-forge/issues/1032)) ([872baa9](https://github.com/ignaciojulio/Stellar-forge/commit/872baa9047675607156a731e1c9de78d4e9843fb))
- align frontend token validation with contract (name ≤ 32 UTF-8 bytes, remove ASCII-only restriction) ([#1125](https://github.com/ignaciojulio/Stellar-forge/issues/1125)) ([cefa9b9](https://github.com/ignaciojulio/Stellar-forge/commit/cefa9b9c13bbc7f2b5a770e5376369c4875c3833))
- **analytics:** add opt-out tests, CI bypass check, and compliance ADR ([#965](https://github.com/ignaciojulio/Stellar-forge/issues/965)) ([180f672](https://github.com/ignaciojulio/Stellar-forge/commit/180f6725d2f82fa5a068687e428886e85179edd3)), closes [#948](https://github.com/ignaciojulio/Stellar-forge/issues/948)
- **api:** add rate limiting to auth challenge endpoints ([#1144](https://github.com/ignaciojulio/Stellar-forge/issues/1144)) ([600e8a0](https://github.com/ignaciojulio/Stellar-forge/commit/600e8a057f98129ad93a520030c3224682da0400)), closes [#1101](https://github.com/ignaciojulio/Stellar-forge/issues/1101)
- **api:** remove clientIp() dead code with inverted XFF parsing (audit [#26](https://github.com/ignaciojulio/Stellar-forge/issues/26)) ([#1129](https://github.com/ignaciojulio/Stellar-forge/issues/1129)) ([fa1a888](https://github.com/ignaciojulio/Stellar-forge/commit/fa1a888c99133d2fafab52f3e79444d1ac188766)), closes [#1101](https://github.com/ignaciojulio/Stellar-forge/issues/1101)
- **api:** sanitize lastError in health/indexer to avoid leaking internal error details ([#1143](https://github.com/ignaciojulio/Stellar-forge/issues/1143)) ([c51d179](https://github.com/ignaciojulio/Stellar-forge/commit/c51d179b782507f167150b719309715fcf6225d9)), closes [#1103](https://github.com/ignaciojulio/Stellar-forge/issues/1103)
- **api:** store wallet-auth challenges in Vercel KV (Closes [#1091](https://github.com/ignaciojulio/Stellar-forge/issues/1091)) ([#1132](https://github.com/ignaciojulio/Stellar-forge/issues/1132)) ([62941bb](https://github.com/ignaciojulio/Stellar-forge/commit/62941bb0131970c10fc56f5fcf19135eefe8de3f))
- audit follow-ups — restore tx polling backoff, fix wasm target, drop orphan form ([05409eb](https://github.com/ignaciojulio/Stellar-forge/commit/05409eb55f4e3ff2797fce06d631fc94553a0239)), closes [#852](https://github.com/ignaciojulio/Stellar-forge/issues/852) [#732](https://github.com/ignaciojulio/Stellar-forge/issues/732) [813/#814](https://github.com/ignaciojulio/Stellar-forge/issues/814)
- **build:** build the contract for wasm32v1-none everywhere ([#940](https://github.com/ignaciojulio/Stellar-forge/issues/940)) ([0aa6df3](https://github.com/ignaciojulio/Stellar-forge/commit/0aa6df38bc25e5bf1941a7dbbafd12616a108505))
- **ci:** remove continue-on-error from fuzz steps, add PR smoke job ([#937](https://github.com/ignaciojulio/Stellar-forge/issues/937)) ([#966](https://github.com/ignaciojulio/Stellar-forge/issues/966)) ([000458f](https://github.com/ignaciojulio/Stellar-forge/commit/000458f8ffde77f136476ea37f2758169f212e07))
- clear cargo clippy -D warnings findings in token-factory ([2a27a8f](https://github.com/ignaciojulio/Stellar-forge/commit/2a27a8fff3e0b78b5173696166315c1470211a09))
- complete contract test suite with all error variants covered ([5f8320d](https://github.com/ignaciojulio/Stellar-forge/commit/5f8320d7b14d3a93339ed3f82779d4763a0717b7))
- **contract:** close open-proxy hole in burn ([#1021](https://github.com/ignaciojulio/Stellar-forge/issues/1021)) ([#1059](https://github.com/ignaciojulio/Stellar-forge/issues/1059)) ([895a621](https://github.com/ignaciojulio/Stellar-forge/commit/895a6218340f8540b8f961ddf47551c96f1c1dbc))
- **contract:** front-load batch validation and document Soroban transaction atomicity ([#915](https://github.com/ignaciojulio/Stellar-forge/issues/915)) ([#974](https://github.com/ignaciojulio/Stellar-forge/issues/974)) ([b60868f](https://github.com/ignaciojulio/Stellar-forge/commit/b60868f0363e8e6c1c89927cfee42fecef7af34a))
- **contracts:** add crash-to-regression-test process with fuzz corpus infrastructure ([#951](https://github.com/ignaciojulio/Stellar-forge/issues/951)) ([9428b7d](https://github.com/ignaciojulio/Stellar-forge/commit/9428b7d209366e9ba62ef72359c902cf9beb79b3)), closes [#938](https://github.com/ignaciojulio/Stellar-forge/issues/938)
- **contracts:** add distribute_fee test coverage at realistic split sizes ([#918](https://github.com/ignaciojulio/Stellar-forge/issues/918)) ([#1025](https://github.com/ignaciojulio/Stellar-forge/issues/1025)) ([f9ec953](https://github.com/ignaciojulio/Stellar-forge/commit/f9ec95316a5ee9968094f12947f7a088cd2b24d1)), closes [#919](https://github.com/ignaciojulio/Stellar-forge/issues/919)
- **contracts:** add integer overflow protection in fee arithmetic ([18622f1](https://github.com/ignaciojulio/Stellar-forge/commit/18622f1777201ba92c4db2ef60928faa4c053de3)), closes [#513](https://github.com/ignaciojulio/Stellar-forge/issues/513)
- **contracts:** charge exactly the required fee, not fee_payment ([#1035](https://github.com/ignaciojulio/Stellar-forge/issues/1035)) ([8654767](https://github.com/ignaciojulio/Stellar-forge/commit/86547670d6b45bf9a967ea59e26813b2670de6b5)), closes [#1007](https://github.com/ignaciojulio/Stellar-forge/issues/1007) [#1007](https://github.com/ignaciojulio/Stellar-forge/issues/1007) [#1008](https://github.com/ignaciojulio/Stellar-forge/issues/1008) [#1008](https://github.com/ignaciojulio/Stellar-forge/issues/1008)
- **contracts:** close remaining FWC26 audit issues ([787dc22](https://github.com/ignaciojulio/Stellar-forge/commit/787dc22d4272d0258856b6a31967c164dcefddda)), closes [909-#948](https://github.com/909-/issues/948) [#1022](https://github.com/ignaciojulio/Stellar-forge/issues/1022) [#910](https://github.com/ignaciojulio/Stellar-forge/issues/910) [#913](https://github.com/ignaciojulio/Stellar-forge/issues/913) [#916](https://github.com/ignaciojulio/Stellar-forge/issues/916) [#943](https://github.com/ignaciojulio/Stellar-forge/issues/943)
- **contracts:** enforce MAX_BATCH_SIZE cap in create_tokens_batch (Closes [#1100](https://github.com/ignaciojulio/Stellar-forge/issues/1100)) ([#1135](https://github.com/ignaciojulio/Stellar-forge/issues/1135)) ([2ba33e5](https://github.com/ignaciojulio/Stellar-forge/commit/2ba33e5e5516b2e3e66388ebd3dcb4568a3b5a14))
- **contracts:** fuzz the real burn entrypoint, not a reimplementation ([#1098](https://github.com/ignaciojulio/Stellar-forge/issues/1098)) ([#1137](https://github.com/ignaciojulio/Stellar-forge/issues/1137)) ([be8a342](https://github.com/ignaciojulio/Stellar-forge/commit/be8a3424d514423f9946635ff899440911bd3377))
- **contracts:** make token-factory initialize atomic with deployment ([#1029](https://github.com/ignaciojulio/Stellar-forge/issues/1029)) ([3e12de2](https://github.com/ignaciojulio/Stellar-forge/commit/3e12de21ff69c7998ff0ad591bc8f066009e364f)), closes [#1005](https://github.com/ignaciojulio/Stellar-forge/issues/1005)
- **contracts:** move per-token bookkeeping to persistent storage ([#1034](https://github.com/ignaciojulio/Stellar-forge/issues/1034)) ([51c52bd](https://github.com/ignaciojulio/Stellar-forge/commit/51c52bd1bcb07eeda1744cd99f82a2816db6aa27)), closes [#1007](https://github.com/ignaciojulio/Stellar-forge/issues/1007) [#1007](https://github.com/ignaciojulio/Stellar-forge/issues/1007)
- **contracts:** prove multi-step migrate pattern with synthetic v2 tests ([#919](https://github.com/ignaciojulio/Stellar-forge/issues/919)) ([#1026](https://github.com/ignaciojulio/Stellar-forge/issues/1026)) ([f9ef384](https://github.com/ignaciojulio/Stellar-forge/commit/f9ef3849f30d7af08473cd66268c0692def6da91)), closes [#918](https://github.com/ignaciojulio/Stellar-forge/issues/918) [#918](https://github.com/ignaciojulio/Stellar-forge/issues/918)
- **contracts:** repair broken merge artifacts on main ([#1041](https://github.com/ignaciojulio/Stellar-forge/issues/1041)) ([6524e58](https://github.com/ignaciojulio/Stellar-forge/commit/6524e58d86b00235622cb07e89d30a756df69f8e)), closes [1034/#1035](https://github.com/ignaciojulio/Stellar-forge/issues/1035) [#1033](https://github.com/ignaciojulio/Stellar-forge/issues/1033) [#1034](https://github.com/ignaciojulio/Stellar-forge/issues/1034) [#1025](https://github.com/ignaciojulio/Stellar-forge/issues/1025)
- **contracts:** seed max-supply counter with initial_supply ([#1006](https://github.com/ignaciojulio/Stellar-forge/issues/1006)) ([#1031](https://github.com/ignaciojulio/Stellar-forge/issues/1031)) ([4a3e90d](https://github.com/ignaciojulio/Stellar-forge/commit/4a3e90de113d45a28f67c765c4a7c07af38c7e44))
- correct useLocalStorage syntax error and variable reference ([232fc52](https://github.com/ignaciojulio/Stellar-forge/commit/232fc520e4df8a4d1345e67e05084ae32252fe5e))
- dedupe token-validation rules in validation.ts ([d3012c2](https://github.com/ignaciojulio/Stellar-forge/commit/d3012c2c310f31135a463f13482af36ec9b1dc46)), closes [#845](https://github.com/ignaciojulio/Stellar-forge/issues/845)
- **deps:** add Dependabot fuzz coverage and auto-merge policy ([#985](https://github.com/ignaciojulio/Stellar-forge/issues/985)) ([2247b9f](https://github.com/ignaciojulio/Stellar-forge/commit/2247b9f0cb3343708d5eebb461280d7e558a5b38)), closes [#941](https://github.com/ignaciojulio/Stellar-forge/issues/941)
- downgrade vite to v6 for Storybook compatibility ([c2f071b](https://github.com/ignaciojulio/Stellar-forge/commit/c2f071bb75ced96669d27f11cec13e11d9c83358))
- **e2e:** add token-list-container class and show 6 trailing address chars ([9fcfff3](https://github.com/ignaciojulio/Stellar-forge/commit/9fcfff3398df79dd9ad987ff4ad51d15409f78b6))
- **e2e:** prevent watcher auto-connect by not responding to REQUEST_NETWORK_DETAILS ([9649702](https://github.com/ignaciojulio/Stellar-forge/commit/9649702d0793d0e489bb9eb2caba0217f3ab99dc))
- exclude fuzz crate from workspace to prevent wasm32 compilation errors ([b3f09f2](https://github.com/ignaciojulio/Stellar-forge/commit/b3f09f208486b314a10fd2f8061b90631fa5df3a))
- expand .gitignore to prevent accidental commits of local artifacts ([1da56fe](https://github.com/ignaciojulio/Stellar-forge/commit/1da56fe00394ccbbff2a86d0de8fa7cf24356924)), closes [#835](https://github.com/ignaciojulio/Stellar-forge/issues/835)
- **explorer:** snapshot tokenCount once per session to prevent pagination drift ([#1126](https://github.com/ignaciojulio/Stellar-forge/issues/1126)) ([a27f77b](https://github.com/ignaciojulio/Stellar-forge/commit/a27f77b8dda5b76feced0cf6baeac7a42a84bcf0))
- **frontend:** clear typecheck errors and prettier drift masked by red CI ([82994b9](https://github.com/ignaciojulio/Stellar-forge/commit/82994b977781c0b616e68b29fa1e1859765b0ac9))
- **frontend:** close network-mismatch signing window with a fresh pre-sign check ([#961](https://github.com/ignaciojulio/Stellar-forge/issues/961)) ([7619e99](https://github.com/ignaciojulio/Stellar-forge/commit/7619e9960d68ad73f6fb67ee0f4f9d11d6ee6ba6)), closes [#927](https://github.com/ignaciojulio/Stellar-forge/issues/927)
- **frontend:** close unclosed PR wrapper in App.tsx and remove duplicate route entries ([4f9442b](https://github.com/ignaciojulio/Stellar-forge/commit/4f9442bda20864966521c36f1ed4272c52f56dd2))
- **frontend:** establish transaction reconciliation policy and add phantom-entry guards ([#955](https://github.com/ignaciojulio/Stellar-forge/issues/955)) ([1372af1](https://github.com/ignaciojulio/Stellar-forge/commit/1372af165a869a1814ef9b43d22c9e9f507190f2)), closes [#933](https://github.com/ignaciojulio/Stellar-forge/issues/933)
- **frontend:** filter-aware cache key, stable useCallback deps, re-fetch on filter change ([62d2c8c](https://github.com/ignaciojulio/Stellar-forge/commit/62d2c8c3aaba49c1099b30db5e3956747b407b9a))
- **frontend:** fix Option encoding, map missing topics, add cap field ([fb3ee73](https://github.com/ignaciojulio/Stellar-forge/commit/fb3ee73daa47161d932d9f91585762223afa6a1a)), closes [#1022](https://github.com/ignaciojulio/Stellar-forge/issues/1022) [#917](https://github.com/ignaciojulio/Stellar-forge/issues/917) [#1022](https://github.com/ignaciojulio/Stellar-forge/issues/1022) [#943](https://github.com/ignaciojulio/Stellar-forge/issues/943)
- **frontend:** handle every sendTransaction status explicitly ([#1020](https://github.com/ignaciojulio/Stellar-forge/issues/1020)) ([#1058](https://github.com/ignaciojulio/Stellar-forge/issues/1058)) ([70ebab6](https://github.com/ignaciojulio/Stellar-forge/commit/70ebab62bea7d7dc887e3ce6852a7f436b023083)), closes [#1056](https://github.com/ignaciojulio/Stellar-forge/issues/1056) [#1057](https://github.com/ignaciojulio/Stellar-forge/issues/1057)
- **frontend:** implement the CSV formula-injection guard its tests expected ([59839b6](https://github.com/ignaciojulio/Stellar-forge/commit/59839b603cf7a84d782a740ff455e9bc9748ed62)), closes [#963](https://github.com/ignaciojulio/Stellar-forge/issues/963)
- **frontend:** make token-detail routes public for deep links ([#880](https://github.com/ignaciojulio/Stellar-forge/issues/880)) ([971e14b](https://github.com/ignaciojulio/Stellar-forge/commit/971e14b24097a4f08688b097225728ed22955c6e))
- **frontend:** only mount OnboardingModal on Help click, not first-visit ([87d3ce4](https://github.com/ignaciojulio/Stellar-forge/commit/87d3ce41a764067f90f0384ce795f6111fdcaeec))
- **frontend:** paginate factory event fetch instead of silently capping "all tokens" ([#962](https://github.com/ignaciojulio/Stellar-forge/issues/962)) ([b480f56](https://github.com/ignaciojulio/Stellar-forge/commit/b480f56b8f935802aab26d2384efcb3eb3da9080)), closes [#35](https://github.com/ignaciojulio/Stellar-forge/issues/35)
- **frontend:** pay real base_fee, surface FeeDisplay in mint, block writes on network mismatch ([6d5697d](https://github.com/ignaciojulio/Stellar-forge/commit/6d5697d3f661be16c4fefccdb1a71f5b5d35734b))
- **frontend:** remove exhaustive-deps suppressions, fix dep arrays ([a8fcf34](https://github.com/ignaciojulio/Stellar-forge/commit/a8fcf3463afe36bacf28f5f1f259eb5f8e7ca845))
- **frontend:** resolve merge fallout — format, getMetadata validation, no-this-alias ([4e0d770](https://github.com/ignaciojulio/Stellar-forge/commit/4e0d77063f0d8b10f23cc9176ea2217bf9337b08))
- **frontend:** resolve token identity from contract, not events ([#1018](https://github.com/ignaciojulio/Stellar-forge/issues/1018)) ([#1030](https://github.com/ignaciojulio/Stellar-forge/issues/1030)) ([66bcb19](https://github.com/ignaciojulio/Stellar-forge/commit/66bcb1915e5199371a1b49f5b353e0aba0dfd86a))
- **frontend:** source FeeDisplay fees from useFactoryState, not the singleton ([e388e7a](https://github.com/ignaciojulio/Stellar-forge/commit/e388e7aacaf66708e01aba263121bd9b932895b2))
- **frontend:** stop passing a decimal XLM string to formatXLM ([d23be61](https://github.com/ignaciojulio/Stellar-forge/commit/d23be616d378af583289ce5544de20673eeb5fda))
- **frontend:** track Horizon paging_token and pass cursor on load-more ([aa6e15b](https://github.com/ignaciojulio/Stellar-forge/commit/aa6e15b235bda5842fed1e8aa5848a2e06b04959))
- **frontend:** unify transaction poll backoff into shared utility ([#960](https://github.com/ignaciojulio/Stellar-forge/issues/960)) ([2ad85fc](https://github.com/ignaciojulio/Stellar-forge/commit/2ad85fc7f43c40a66746519eccaf89cb5147e53c))
- **frontend:** wire orphaned features, fix standalone network, add typecheck gate ([c14d1b1](https://github.com/ignaciojulio/Stellar-forge/commit/c14d1b108ef210ede1d007f231cd4797f844fe26))
- **infra:** consolidate vercel.json security headers (Closes [#1104](https://github.com/ignaciojulio/Stellar-forge/issues/1104)) ([#1134](https://github.com/ignaciojulio/Stellar-forge/issues/1134)) ([fc64bea](https://github.com/ignaciojulio/Stellar-forge/commit/fc64bea1d5185c43fe289214857246bfe014e51c))
- **infra:** schedule the indexer cron in vercel.json (Closes [#1090](https://github.com/ignaciojulio/Stellar-forge/issues/1090)) ([#1130](https://github.com/ignaciojulio/Stellar-forge/issues/1130)) ([288d5f3](https://github.com/ignaciojulio/Stellar-forge/commit/288d5f3b1208405fd08e12342fef2ae58cf25a7b)), closes [#1123](https://github.com/ignaciojulio/Stellar-forge/issues/1123) [#1124](https://github.com/ignaciojulio/Stellar-forge/issues/1124) [#1125](https://github.com/ignaciojulio/Stellar-forge/issues/1125) [#1126](https://github.com/ignaciojulio/Stellar-forge/issues/1126) [#1126](https://github.com/ignaciojulio/Stellar-forge/issues/1126) [#1126](https://github.com/ignaciojulio/Stellar-forge/issues/1126) [#1121](https://github.com/ignaciojulio/Stellar-forge/issues/1121) [#1121](https://github.com/ignaciojulio/Stellar-forge/issues/1121)
- **ipfs:** retry image upload on transient Pinata errors ([26a2005](https://github.com/ignaciojulio/Stellar-forge/commit/26a2005ebfbe5c27c7f132c3f0a031d5c750ac30)), closes [#743](https://github.com/ignaciojulio/Stellar-forge/issues/743)
- **ipfs:** validate getMetadata response shape before returning ([7183346](https://github.com/ignaciojulio/Stellar-forge/commit/71833467e8e0aa7c8a770d2905056227e721378c)), closes [#849](https://github.com/ignaciojulio/Stellar-forge/issues/849)
- isolate per-recipient fee-split transfer failures from aborting the call ([#1136](https://github.com/ignaciojulio/Stellar-forge/issues/1136)) ([6e68f0d](https://github.com/ignaciojulio/Stellar-forge/commit/6e68f0d78f1272fa6a31cc6d8cb54859dc9fb83b))
- make all 202 tests pass ([1043432](https://github.com/ignaciojulio/Stellar-forge/commit/1043432dcdf6307385661d7261fd8f73bcae6923))
- pin esbuild/globals devDeps and apply npm audit fixes ([6ccd8c3](https://github.com/ignaciojulio/Stellar-forge/commit/6ccd8c3418b8617052bd8c290231cabad9d82119))
- provide VITE_TOKEN_WASM_HASH in E2E CI job ([64c1a5b](https://github.com/ignaciojulio/Stellar-forge/commit/64c1a5b24f90f4685b1690b8653e620768924240))
- real bugs surfaced while restoring lint/test coverage ([8434f56](https://github.com/ignaciojulio/Stellar-forge/commit/8434f5688c3f8877513c5931eef26bf93b85091f))
- reclaim orphaned IPFS pins on failed set_metadata (Closes [#1096](https://github.com/ignaciojulio/Stellar-forge/issues/1096)) ([#1146](https://github.com/ignaciojulio/Stellar-forge/issues/1146)) ([d845880](https://github.com/ignaciojulio/Stellar-forge/commit/d84588094a620097ffcb3d66135201ffedc70ad8))
- redesign fee transfer and token deployment per issue spec ([e7b8c9e](https://github.com/ignaciojulio/Stellar-forge/commit/e7b8c9e7f0a77cb618b39afa0b91ea6ac87c5b21))
- refactor build system, fix contract errors, fix dark mode toggle ([85751f8](https://github.com/ignaciojulio/Stellar-forge/commit/85751f85239640acbae8197feccb14ff63724c16))
- relabel TokenDetail Admin field to 'Deployed by' (Closes [#1109](https://github.com/ignaciojulio/Stellar-forge/issues/1109)) ([#1119](https://github.com/ignaciojulio/Stellar-forge/issues/1119)) ([5d5df07](https://github.com/ignaciojulio/Stellar-forge/commit/5d5df075612a6e510448e17087c281d987a36478))
- **release:** add @actions/io to satisfy @actions/exec's undeclared import ([cd21fdc](https://github.com/ignaciojulio/Stellar-forge/commit/cd21fdc70110759165e95d85803d48f15dd7225f))
- **release:** disable husky hooks in the release workflow ([5429060](https://github.com/ignaciojulio/Stellar-forge/commit/5429060a58cf30265f835f3954a420de043452df))
- remove 'unsafe-inline' from CSP style-src (Closes [#1105](https://github.com/ignaciojulio/Stellar-forge/issues/1105)) ([#1123](https://github.com/ignaciojulio/Stellar-forge/issues/1123)) ([838129c](https://github.com/ignaciojulio/Stellar-forge/commit/838129ccc63f862350ac86ee1efcc1ba2ae4a163))
- repair local Stellar network startup in E2E CI job ([5aa9026](https://github.com/ignaciojulio/Stellar-forge/commit/5aa90265077404369cfe81c6a96eb94017075893))
- replace console.error with logger in CreateToken, TokenForm, MetadataUploadForm ([24805af](https://github.com/ignaciojulio/Stellar-forge/commit/24805af56b93e60392a4817ba8708c29960dd043)), closes [#848](https://github.com/ignaciojulio/Stellar-forge/issues/848)
- replace invalid checksum address in validation test ([64ac45a](https://github.com/ignaciojulio/Stellar-forge/commit/64ac45ae4179ede5aa0fce9533ffaae640ef2084))
- resolve build failure blocking strict mode verification ([e3370f5](https://github.com/ignaciojulio/Stellar-forge/commit/e3370f50dec6af5a2780d35d7e11462ecf0c3145))
- resolve Horizon URL from active network config in useTransactionHistory ([2c25a2d](https://github.com/ignaciojulio/Stellar-forge/commit/2c25a2d2d3b43a72c5453e84f2e2707b4d443696)), closes [#837](https://github.com/ignaciojulio/Stellar-forge/issues/837)
- restore ESLint v9 flat config ([a85d008](https://github.com/ignaciojulio/Stellar-forge/commit/a85d008e18a7f925eff1fd5a7361e624754f28cf))
- **routing:** fix deep-link for /token/:address and add e2e tests ([1eb308a](https://github.com/ignaciojulio/Stellar-forge/commit/1eb308ab9014c595c30aa3868e9d3e4b87278470))
- **security:** stop shipping Pinata credentials in the frontend bundle ([#921](https://github.com/ignaciojulio/Stellar-forge/issues/921)) ([2a23cad](https://github.com/ignaciojulio/Stellar-forge/commit/2a23cad10304a6b822720ec0ac4cfe5eb19d3a09))
- **security:** validate uploaded image content, not client-declared M… ([#1055](https://github.com/ignaciojulio/Stellar-forge/issues/1055)) ([ab1f253](https://github.com/ignaciojulio/Stellar-forge/commit/ab1f25398d2c0a1c2a1a6418364423e5a0dfe577)), closes [#1002](https://github.com/ignaciojulio/Stellar-forge/issues/1002) [#1002](https://github.com/ignaciojulio/Stellar-forge/issues/1002) [#1056](https://github.com/ignaciojulio/Stellar-forge/issues/1056) [#1057](https://github.com/ignaciojulio/Stellar-forge/issues/1057)
- **specs:** resolve spec stubs and enforce kiro spec documentation ([#1117](https://github.com/ignaciojulio/Stellar-forge/issues/1117)) ([#1120](https://github.com/ignaciojulio/Stellar-forge/issues/1120)) ([0875cd2](https://github.com/ignaciojulio/Stellar-forge/commit/0875cd23e96ae0bb87a7d897418349aaa04b18d8)), closes [#1099](https://github.com/ignaciojulio/Stellar-forge/issues/1099) [#1107](https://github.com/ignaciojulio/Stellar-forge/issues/1107) [#1108](https://github.com/ignaciojulio/Stellar-forge/issues/1108) [#1113](https://github.com/ignaciojulio/Stellar-forge/issues/1113) [#1118](https://github.com/ignaciojulio/Stellar-forge/issues/1118)
- stop E2E app crash on unknown network and repair Freighter mock ([232afee](https://github.com/ignaciojulio/Stellar-forge/commit/232afee01997300d0fb64ebbe5101d9c11c520fb))
- **storybook:** finish the Storybook 10 migration ([a66a453](https://github.com/ignaciojulio/Stellar-forge/commit/a66a453846c86dd2ee83fcb347380b26af4c66ef)), closes [#893](https://github.com/ignaciojulio/Stellar-forge/issues/893)
- **token-factory:** bound fee-split recipient count to prevent resource-exhaustion griefing ([#1027](https://github.com/ignaciojulio/Stellar-forge/issues/1027)) ([becd28f](https://github.com/ignaciojulio/Stellar-forge/commit/becd28f8647eef2fa7e62a9d42b9626413c00216))
- **token-factory:** enforce strict clippy linting for contract code ([686b143](https://github.com/ignaciojulio/Stellar-forge/commit/686b143cec68646bffeb75790ac317a450742f1f))
- **token-factory:** extend reentrancy guard to all state-mutating entrypoints ([#972](https://github.com/ignaciojulio/Stellar-forge/issues/972)) ([45a1a9c](https://github.com/ignaciojulio/Stellar-forge/commit/45a1a9c1f077d7dbb4e6989ce6ccf42195e88fce))
- **token-factory:** reject negative base_fee and metadata_fee ([#973](https://github.com/ignaciojulio/Stellar-forge/issues/973)) ([e3cdd5e](https://github.com/ignaciojulio/Stellar-forge/commit/e3cdd5eb5de4962381800beaa58853b45ee4b46d))
- **token-factory:** store token_wasm_hash in FactoryState ([7de1635](https://github.com/ignaciojulio/Stellar-forge/commit/7de1635b752553f7166f4e6838620a4dd8d540cc)), closes [#543](https://github.com/ignaciojulio/Stellar-forge/issues/543)
- **ui:** sanitize and validate token name/symbol inputs ([1e4e2e7](https://github.com/ignaciojulio/Stellar-forge/commit/1e4e2e74f4f0dec3fa06cd44bc4892e76dd421d7))
- upgrade soroban-sdk to 25.x and fix wasm build ([1e098e1](https://github.com/ignaciojulio/Stellar-forge/commit/1e098e149830f6a10e319bd4ac26ef6db8c1c13a))
- Use correct validation function name in MetadataUploadForm ([b8802cf](https://github.com/ignaciojulio/Stellar-forge/commit/b8802cfd55f2f9f80e2ec76387c9d91b14bce9e5))
- use dedicated fee_token for all fee transfers in factory contract ([14db340](https://github.com/ignaciojulio/Stellar-forge/commit/14db340019273fbbd6538c240d765aba96906ec5))
- use formatXLM and stroopsToXLM in FeeDisplay and add conversion test ([65b5d94](https://github.com/ignaciojulio/Stellar-forge/commit/65b5d944ea82d68e68dd816830751533bf58eca2))
- validate hexToBytes input is exactly 64 hex chars ([4165f9f](https://github.com/ignaciojulio/Stellar-forge/commit/4165f9f3a9d7285fe3ae50c5784f257c73d77716)), closes [#836](https://github.com/ignaciojulio/Stellar-forge/issues/836)
- validate token supply before minting to prevent u128 overflow ([#959](https://github.com/ignaciojulio/Stellar-forge/issues/959)) ([d4027c8](https://github.com/ignaciojulio/Stellar-forge/commit/d4027c81e69c2d2434374a41e8d2bd514a647c26)), closes [#909](https://github.com/ignaciojulio/Stellar-forge/issues/909)
- **validation:** use StrKey checksum validation for Stellar addresses ([c55f0f4](https://github.com/ignaciojulio/Stellar-forge/commit/c55f0f49232a10494906398930488a8eb7e7f9bc))
- **wallet:** clear all state and token cache on disconnect ([a2b1ed3](https://github.com/ignaciojulio/Stellar-forge/commit/a2b1ed36c3413c37eca259e389307a2f6f06f556))

### Features

- **#588:** Build Token Creation Form UI ([b13478c](https://github.com/ignaciojulio/Stellar-forge/commit/b13478ce4ce5f7f5ff75bd629ee82c8e77c6e00b)), closes [#588](https://github.com/ignaciojulio/Stellar-forge/issues/588)
- **#589:** Implement StellarService Token Deployment ([b186936](https://github.com/ignaciojulio/Stellar-forge/commit/b18693646c7a9a6826cae19aef04b6b97fe95e16)), closes [#589](https://github.com/ignaciojulio/Stellar-forge/issues/589)
- **#590:** Implement IPFS Metadata Upload via Pinata ([98e1fc0](https://github.com/ignaciojulio/Stellar-forge/commit/98e1fc05522b123fdfba8949d4f891d09ca36315)), closes [#590](https://github.com/ignaciojulio/Stellar-forge/issues/590)
- **#603:** Create Token Detail Page ([a1aa1ec](https://github.com/ignaciojulio/Stellar-forge/commit/a1aa1ecd6ccad4ec4e2b00a59e706cff4b133c13)), closes [#603](https://github.com/ignaciojulio/Stellar-forge/issues/603)
- **#604:** Add React Router for Navigation ([be195b5](https://github.com/ignaciojulio/Stellar-forge/commit/be195b50249bb8d3cfe632338b279ccbab3078c1)), closes [#604](https://github.com/ignaciojulio/Stellar-forge/issues/604)
- **#606:** Add loading states and skeleton UI ([41111e0](https://github.com/ignaciojulio/Stellar-forge/commit/41111e0675574976efd551268375a5f5aafa094e)), closes [#606](https://github.com/ignaciojulio/Stellar-forge/issues/606)
- **#607:** Add environment variable validation on startup ([5e3ff84](https://github.com/ignaciojulio/Stellar-forge/commit/5e3ff842dee16505f089da8fa8ddf59ff1cbf0aa)), closes [#607](https://github.com/ignaciojulio/Stellar-forge/issues/607)
- **#734:** Add debounced search and creator address filter to TokenExplorer ([12c703b](https://github.com/ignaciojulio/Stellar-forge/commit/12c703bf6f4ef881be1aec3fb7a31659182a05fb)), closes [#734](https://github.com/ignaciojulio/Stellar-forge/issues/734)
- **#fuzz:** add fuzz targets for set_metadata and mint_tokens ([167432d](https://github.com/ignaciojulio/Stellar-forge/commit/167432dc36b3a44d2fa2b3bcd891af976dc06ab6)), closes [#fuzz](https://github.com/ignaciojulio/Stellar-forge/issues/fuzz)
- **a11y:** accessibility audit and fixes ([98eb2f7](https://github.com/ignaciojulio/Stellar-forge/commit/98eb2f7bce43199095257b3f21b29347db71fb7d))
- add accessibility improvements (a11y) ([259d1b0](https://github.com/ignaciojulio/Stellar-forge/commit/259d1b0ba239906605b10feb7a151deea01bb70b))
- add AddressDisplay component with copy and explorer link ([2ab3bda](https://github.com/ignaciojulio/Stellar-forge/commit/2ab3bdaa16ba838f6da55e681983df940707cb31))
- add analytics integration spec and scaffolding ([#522](https://github.com/ignaciojulio/Stellar-forge/issues/522)) ([e4d8902](https://github.com/ignaciojulio/Stellar-forge/commit/e4d89029fe13ea8a94a574bc2028f9090bc51cc0))
- add CHANGELOG.md and PR template with changelog checklist ([89bb67e](https://github.com/ignaciojulio/Stellar-forge/commit/89bb67ed0b73c25e9a0fad46554b8ee6c35e17cb))
- add client-side CID verification for metadata integrity ([#1139](https://github.com/ignaciojulio/Stellar-forge/issues/1139)) ([82e9a1b](https://github.com/ignaciojulio/Stellar-forge/commit/82e9a1b72bf1c78efede6522669d40707a5f295c))
- add client-side routing with react-router-dom (fixes [#471](https://github.com/ignaciojulio/Stellar-forge/issues/471)) ([baee94d](https://github.com/ignaciojulio/Stellar-forge/commit/baee94d5865dea41be3e3a0caa3a70952c8f45b3))
- add comprehensive error handling system ([62b4348](https://github.com/ignaciojulio/Stellar-forge/commit/62b43485f363fcdd348e518631221dcdedbca452))
- add ConfirmModal before all on-chain transactions ([3cef134](https://github.com/ignaciojulio/Stellar-forge/commit/3cef134598c07ec70c6c8d7ed84549da9a0c6162))
- add Content-Security-Policy headers ([ef28578](https://github.com/ignaciojulio/Stellar-forge/commit/ef285786231bd883fab9b5e4f2e369658cb010b4))
- add contract event history with pagination ([0425f56](https://github.com/ignaciojulio/Stellar-forge/commit/0425f560eb14fe3ab740e9e1726e045d9259772a))
- add contract event indexing spec ([#612](https://github.com/ignaciojulio/Stellar-forge/issues/612)) ([5952c01](https://github.com/ignaciojulio/Stellar-forge/commit/5952c015de58f01b79a0a3978f7baa09e1ec8c4c))
- add CopyButton component and integrations [#491](https://github.com/ignaciojulio/Stellar-forge/issues/491) ([6d16970](https://github.com/ignaciojulio/Stellar-forge/commit/6d1697051d31d6876a50008a3d7669f69d5315b6))
- add dark mode support with localStorage persistence ([24e96e5](https://github.com/ignaciojulio/Stellar-forge/commit/24e96e584e68fdf5177d3631d5172f390ed08465))
- add dark mode with system preference, localStorage persistence, and toggle button ([5658728](https://github.com/ignaciojulio/Stellar-forge/commit/5658728f0ba9b5825e3f002c10a8a381c4434ced))
- add decimals validation for create_token (0-18 inclusive) ([f88ec3c](https://github.com/ignaciojulio/Stellar-forge/commit/f88ec3c3e3100c34bb383c6b90a92fcb1fd33cc4)), closes [#515](https://github.com/ignaciojulio/Stellar-forge/issues/515)
- add deploy-contract.sh script for automated contract deployment ([f478eb2](https://github.com/ignaciojulio/Stellar-forge/commit/f478eb2f264a2ad65366be6217dd897ab5ca1e26))
- add E2E coverage for network mismatch guard across all write forms Closes [#935](https://github.com/ignaciojulio/Stellar-forge/issues/935) ([#970](https://github.com/ignaciojulio/Stellar-forge/issues/970)) ([a644ce6](https://github.com/ignaciojulio/Stellar-forge/commit/a644ce657163e43308840ecb8e4a5582b7046cf7))
- add env variable validation and configuration guide ([98642d9](https://github.com/ignaciojulio/Stellar-forge/commit/98642d9dd07b242b72fa17f7c71c90749209cf71)), closes [#8](https://github.com/ignaciojulio/Stellar-forge/issues/8)
- add ErrorBoundary component to catch render errors ([d297816](https://github.com/ignaciojulio/Stellar-forge/commit/d29781600265a3afc90e905556a2b1c995f2dd29))
- add eslint import order rule spec ([ca4bc6b](https://github.com/ignaciojulio/Stellar-forge/commit/ca4bc6bad5f926f67845006654a62d413a8d7446))
- add export CSV functionality to TransactionHistory ([637dc7c](https://github.com/ignaciojulio/Stellar-forge/commit/637dc7cfdb0c15520196983a6f5a87e0504fe0a1))
- add fee bump transaction support ([#63](https://github.com/ignaciojulio/Stellar-forge/issues/63)) ([9b2b8ea](https://github.com/ignaciojulio/Stellar-forge/commit/9b2b8ea83cad398c574e53d1b5e50876c58252e7))
- add FeeDisplay component with module-level cache ([e749987](https://github.com/ignaciojulio/Stellar-forge/commit/e749987653db420fb5261cbe857fb557a697ecd1))
- add formatTimestamp and timeAgo utilities (#issue) ([02f8f30](https://github.com/ignaciojulio/Stellar-forge/commit/02f8f308f23c64b660d3419496b21085f9f35059)), closes [#issue](https://github.com/ignaciojulio/Stellar-forge/issues/issue)
- add formatTokenAmount and parseTokenAmount utilities ([1041ada](https://github.com/ignaciojulio/Stellar-forge/commit/1041ada734af076be7fd095d40e6c87ab39b58ed))
- add French (fr) locale i18n support ([4429f89](https://github.com/ignaciojulio/Stellar-forge/commit/4429f898c5906e2f42b38d3b3069af5acf8b07bd)), closes [#740](https://github.com/ignaciojulio/Stellar-forge/issues/740)
- add friendbot banner for testnet ([aece4cb](https://github.com/ignaciojulio/Stellar-forge/commit/aece4cb99d882cf89cd6e87ba8a97312300ead57))
- add frontend unit tests and fix retry unhandled rejections ([ec4b78b](https://github.com/ignaciojulio/Stellar-forge/commit/ec4b78b50b9ce92b0c37c64e705b0bd81a0f5f10)), closes [#9](https://github.com/ignaciojulio/Stellar-forge/issues/9)
- add frontend unit tests for validation utils ([#609](https://github.com/ignaciojulio/Stellar-forge/issues/609)) ([5ef4995](https://github.com/ignaciojulio/Stellar-forge/commit/5ef4995f2fce86123490a70b7a320a21ef5cdd19))
- add get_tokens_by_creator view function ([#38](https://github.com/ignaciojulio/Stellar-forge/issues/38)) ([17b7ae0](https://github.com/ignaciojulio/Stellar-forge/commit/17b7ae09f4e8bca9660d61389704a18eab50a42f))
- add global toast notification system ([ea22272](https://github.com/ignaciojulio/Stellar-forge/commit/ea22272f16cffdd0390b85ceb56a54fd0fbf519e))
- Add husky + lint-staged pre-commit hooks ([#59](https://github.com/ignaciojulio/Stellar-forge/issues/59)) ([b11c468](https://github.com/ignaciojulio/Stellar-forge/commit/b11c4682e0bf0fbcf4b9885237b135142211c366))
- add Husky pre-commit and pre-push hooks ([#533](https://github.com/ignaciojulio/Stellar-forge/issues/533)) ([c232169](https://github.com/ignaciojulio/Stellar-forge/commit/c232169967c5bcf58d07aeb4885efeed39444ce0))
- add i18n foundation with react-i18next ([0f8c270](https://github.com/ignaciojulio/Stellar-forge/commit/0f8c2706990f5b6b6ce9f4c17876efee909929b1))
- add isValidIPFSUri validation utility and SetMetadataForm ([#33](https://github.com/ignaciojulio/Stellar-forge/issues/33)) ([5ba129f](https://github.com/ignaciojulio/Stellar-forge/commit/5ba129f8148add491d6dfd406138a3a3ab3a7f1c))
- add isValidIPFSUri validation utility and SetMetadataForm ([#33](https://github.com/ignaciojulio/Stellar-forge/issues/33)) ([9e76fc4](https://github.com/ignaciojulio/Stellar-forge/commit/9e76fc48a45c3512ffcc7e9c5edffae81dd0fdf6))
- Add mainnet deployment checklist modal ([#35](https://github.com/ignaciojulio/Stellar-forge/issues/35)) ([d3e8f2d](https://github.com/ignaciojulio/Stellar-forge/commit/d3e8f2dfd04536bc5fede24ca84d1e0d416c8e39))
- add MetadataAlreadySet guard in set_metadata ([ebbdd65](https://github.com/ignaciojulio/Stellar-forge/commit/ebbdd65360b829419d112b4dc8544c0396502a65))
- add MintForm component with address validation and mintTokens service ([ac9df39](https://github.com/ignaciojulio/Stellar-forge/commit/ac9df395c2e4b4ad710f86211f0ee626e76238e0))
- add network switching support ([#680](https://github.com/ignaciojulio/Stellar-forge/issues/680)) ([60e9f3f](https://github.com/ignaciojulio/Stellar-forge/commit/60e9f3fb185c5be0e93d0763c1ada5c6818ec3f3))
- add OG tags, react-router-dom, clippy CI, and npm ci ([24d091c](https://github.com/ignaciojulio/Stellar-forge/commit/24d091c957c65e2b03eb374edfeb9f62c780d969)), closes [#54](https://github.com/ignaciojulio/Stellar-forge/issues/54) [#56](https://github.com/ignaciojulio/Stellar-forge/issues/56) [#68](https://github.com/ignaciojulio/Stellar-forge/issues/68) [#85](https://github.com/ignaciojulio/Stellar-forge/issues/85)
- add pause/unpause admin function to factory contract ([#39](https://github.com/ignaciojulio/Stellar-forge/issues/39)) ([5a5c965](https://github.com/ignaciojulio/Stellar-forge/commit/5a5c9657eb01f741a73fd68b07e8c129c0b72494))
- add polling, last-updated indicator, and refresh to transaction history ([ac79943](https://github.com/ignaciojulio/Stellar-forge/commit/ac799436d088dc8a3876b6b1f8f1f3bda7e57e9e)), closes [#752](https://github.com/ignaciojulio/Stellar-forge/issues/752)
- add Prettier, fix all TS errors, add CI/CD pipeline, add formatAddress and Checkbox UI component ([a11180e](https://github.com/ignaciojulio/Stellar-forge/commit/a11180e10be6c60a668889a4ca85c4056e65db23))
- add PWA support with vite-plugin-pwa ([#81](https://github.com/ignaciojulio/Stellar-forge/issues/81)) ([547110c](https://github.com/ignaciojulio/Stellar-forge/commit/547110c7a3bf0b9308433e6541a72851315dbc7f))
- add reentrancy guard to create_token with Error::Reentrancy variant ([986de4b](https://github.com/ignaciojulio/Stellar-forge/commit/986de4be908dde9aca2df9497827bd4e57c72188))
- add reusable Modal base component ([#527](https://github.com/ignaciojulio/Stellar-forge/issues/527)) ([e19c519](https://github.com/ignaciojulio/Stellar-forge/commit/e19c519d5362139603878ae605d798d0f32d4885))
- add reusable Modal base component ([#527](https://github.com/ignaciojulio/Stellar-forge/issues/527)) ([f605b53](https://github.com/ignaciojulio/Stellar-forge/commit/f605b537b184538356ec3f5dfaf6e77a7023ec68))
- add robots.txt, sitemap.xml, and meta description for SEO ([de6bb1c](https://github.com/ignaciojulio/Stellar-forge/commit/de6bb1ca190af7144dbcf42c4e375fb037629e40))
- add robust useClipboard hook and refactor dashboard ([7149392](https://github.com/ignaciojulio/Stellar-forge/commit/7149392879177afb4890d27e84fcafd74993380c)), closes [#26](https://github.com/ignaciojulio/Stellar-forge/issues/26)
- add secure Admin Panel for factory fee management ([39e28a5](https://github.com/ignaciojulio/Stellar-forge/commit/39e28a5d8ea44f66da35c9103d0283f8ebbca68a))
- Add security disclosure policy ([#47](https://github.com/ignaciojulio/Stellar-forge/issues/47)) ([096fcd7](https://github.com/ignaciojulio/Stellar-forge/commit/096fcd7db59170ab86e51293dfd1c261de5b856c))
- Add Select UI component with accessibility and dark mode support ([412420a](https://github.com/ignaciojulio/Stellar-forge/commit/412420aaf6de26d11d299790904564aada4d9982))
- add semantic release for automated versioning ([bcd42fe](https://github.com/ignaciojulio/Stellar-forge/commit/bcd42fe4045889bb25e4c751a1999444d91b9e48))
- add sitemap generation script and update prebuild script to include it ([8948663](https://github.com/ignaciojulio/Stellar-forge/commit/89486632614de04d357937eebec497dfcd8656bc))
- add skeleton loaders and a11y improvements ([#475](https://github.com/ignaciojulio/Stellar-forge/issues/475), [#477](https://github.com/ignaciojulio/Stellar-forge/issues/477)) ([1ea1e54](https://github.com/ignaciojulio/Stellar-forge/commit/1ea1e54760f52c844e342691ade1968f9d9f3db4))
- add skeleton loaders for TokenExplorer and Dashboard ([42867fe](https://github.com/ignaciojulio/Stellar-forge/commit/42867fe60d0626302ff16fe9f97da65e7ca44aa9)), closes [#735](https://github.com/ignaciojulio/Stellar-forge/issues/735)
- add skeleton-loaders spec (requirements, design, tasks) ([ec3a9ed](https://github.com/ignaciojulio/Stellar-forge/commit/ec3a9edccdea9cb861af1c086b32f0e45188e011))
- add social sharing for newly created tokens ([#521](https://github.com/ignaciojulio/Stellar-forge/issues/521)) ([7e2cdcc](https://github.com/ignaciojulio/Stellar-forge/commit/7e2cdcc311980edab824795b7afb3fa37f5bf470))
- add Soroban benchmark harness for resource cost tracking ([#968](https://github.com/ignaciojulio/Stellar-forge/issues/968)) ([91b504f](https://github.com/ignaciojulio/Stellar-forge/commit/91b504f5f459c5e5491cf181a30c00c4611bfb1d)), closes [#12](https://github.com/ignaciojulio/Stellar-forge/issues/12)
- add soroban-token-sdk audit spec ([ae3686a](https://github.com/ignaciojulio/Stellar-forge/commit/ae3686a6aa6a9ea90c65cdac09212cbc17484e50))
- add stellar contract optimize to deployment workflow ([4a56338](https://github.com/ignaciojulio/Stellar-forge/commit/4a5633820d68a264160311da5c161e36fa3dec9d))
- add stellarExplorerUrl utility and wire explorer links ([d043699](https://github.com/ignaciojulio/Stellar-forge/commit/d04369980cab1a6f5a29c557b4857fdec90d0b43))
- add Storybook stories for ConfirmModal, ProgressIndicator, and InsufficientBalanceWarning ([a25343e](https://github.com/ignaciojulio/Stellar-forge/commit/a25343ef58f82389e1ee34d6e81304cf0bcba9c8))
- add Storybook with stories for all UI components ([564a5b8](https://github.com/ignaciojulio/Stellar-forge/commit/564a5b8747b18cecec42b800a28dd3b4845a51e6))
- add Terms of Service acceptance modal before first transaction ([#529](https://github.com/ignaciojulio/Stellar-forge/issues/529)) ([53a7bc8](https://github.com/ignaciojulio/Stellar-forge/commit/53a7bc8473d5bfc7ddc0b4c8bb6b34d28c6f0b10))
- add Terms of Service acceptance modal before first transaction ([#529](https://github.com/ignaciojulio/Stellar-forge/issues/529)) ([b2ddf76](https://github.com/ignaciojulio/Stellar-forge/commit/b2ddf76f997e7098519c2db85ef732176cc34ecf))
- add testnet faucet integration via Friendbot ([#519](https://github.com/ignaciojulio/Stellar-forge/issues/519)) ([f7c2965](https://github.com/ignaciojulio/Stellar-forge/commit/f7c29653018bc9422437a517de60b021c9d9fd94))
- add token event history with pagination and event details display ([9196fdf](https://github.com/ignaciojulio/Stellar-forge/commit/9196fdfa879502ba361811ad750a45319afee0e4))
- add token search, filter, and sort to Dashboard ([a17250a](https://github.com/ignaciojulio/Stellar-forge/commit/a17250a7e7415c736f7abfb26c24ad63cce35e51))
- add token search, filter, and sort to dashboard ([#64](https://github.com/ignaciojulio/Stellar-forge/issues/64)) ([eb80749](https://github.com/ignaciojulio/Stellar-forge/commit/eb80749f6deacb0dab54ba40af95e1d1693cdb81))
- add TokenDashboard with pagination, search, and Explorer links ([d7ce574](https://github.com/ignaciojulio/Stellar-forge/commit/d7ce574bcb1e0b4670e1cc9c2d895946776aaf1a))
- add TokenExplorer component with search and pagination ([4b21179](https://github.com/ignaciojulio/Stellar-forge/commit/4b211798c41fbfb492613f48e66a6bb174a37da1))
- add TokenMetadata display component ([658efc0](https://github.com/ignaciojulio/Stellar-forge/commit/658efc0c1321a6b4794c0682e75894e0a45e66aa))
- Add transaction retry logic with exponential backoff ([#62](https://github.com/ignaciojulio/Stellar-forge/issues/62)) ([f0d8f02](https://github.com/ignaciojulio/Stellar-forge/commit/f0d8f02c2d45a8649b21ef2a83f69fc757033bba))
- Add TransactionHistory component and useTransactionHistory hook for Stellar token operations ([f8fed91](https://github.com/ignaciojulio/Stellar-forge/commit/f8fed914347008992fae259b506952c2d0c7ae88))
- Add TransactionStatus component and tests ([4637fb8](https://github.com/ignaciojulio/Stellar-forge/commit/4637fb8c495482a5609f2f90ea6a5309aa09dd57))
- add transfer_admin function with tests ([347d54f](https://github.com/ignaciojulio/Stellar-forge/commit/347d54fbbf885985964f991d51ed4c6807dcd071))
- add TTL management for all Soroban storage writes ([7b34532](https://github.com/ignaciojulio/Stellar-forge/commit/7b3453265f83cbc0fe7f0dcaf8a736f21902887c))
- add UI barrel export and update all imports ([2e4fbe0](https://github.com/ignaciojulio/Stellar-forge/commit/2e4fbe0e006564fee5c51396ba9137e9de42793c))
- add update_admin function to token factory contract ([#479](https://github.com/ignaciojulio/Stellar-forge/issues/479)) ([5db1fe4](https://github.com/ignaciojulio/Stellar-forge/commit/5db1fe4734dc41788232efd3e11397bf74bd2954))
- add useDebounce hook, apply to MintForm/BurnForm/Dashboard, fix build ([e8727e1](https://github.com/ignaciojulio/Stellar-forge/commit/e8727e16b4f1c50beca6977389720fe1497b192b))
- add useFactoryState hook, coverage thresholds, and CI workflow ([15b366d](https://github.com/ignaciojulio/Stellar-forge/commit/15b366d315366e901a05351e7d200da9330bd39d))
- Add useLocalStorage hook and tests ([56eac71](https://github.com/ignaciojulio/Stellar-forge/commit/56eac719547fd75bdd916da05ab5a8bcde6fc663))
- add useTokenBalance hook and fix TypeScript errors ([43792b7](https://github.com/ignaciojulio/Stellar-forge/commit/43792b7593c29fff7929ca1c52e9096b32c4e3ef))
- add useTokens pagination and useTokenInfo hook ([a473194](https://github.com/ignaciojulio/Stellar-forge/commit/a473194fbf697aa6feeed853de1253c30d8947df))
- add VITE_TOKEN_WASM_HASH to env validation and fix duplicate import ([b027cc2](https://github.com/ignaciojulio/Stellar-forge/commit/b027cc256bc2c3381cedcfab7b48a81805e7f41f))
- add wallet token portfolio dashboard ([cc28ab9](https://github.com/ignaciojulio/Stellar-forge/commit/cc28ab9f2d9505077bfbc430aac870983c6979f7))
- add WalletButton UI component and integrate into App.tsx header ([cf20f69](https://github.com/ignaciojulio/Stellar-forge/commit/cf20f695cb93d60d96fa4f5f1592f1395ac2ef4f))
- add wasm-opt post-processing for contract binary ([de1f779](https://github.com/ignaciojulio/Stellar-forge/commit/de1f779897d4ddbc938d9d1d58e1020d352081a0))
- add whitelist for fee-free token creation ([59c0f59](https://github.com/ignaciojulio/Stellar-forge/commit/59c0f598ecfd74fa1cfe5a036a8ac22418e0d823))
- **api:** add off-chain contract event indexer ([#943](https://github.com/ignaciojulio/Stellar-forge/issues/943)) ([19a9544](https://github.com/ignaciojulio/Stellar-forge/commit/19a9544f64827539f6c763c7f9c5b0df725b3cf0))
- **api:** persist contract events in the indexer store (supersedes [#1138](https://github.com/ignaciojulio/Stellar-forge/issues/1138)) ([#1154](https://github.com/ignaciojulio/Stellar-forge/issues/1154)) ([45ad5bc](https://github.com/ignaciojulio/Stellar-forge/commit/45ad5bc0af5d6a8079746f03ff2399fc47be653b))
- build token creation form UI on home page ([#667](https://github.com/ignaciojulio/Stellar-forge/issues/667)) ([0311381](https://github.com/ignaciojulio/Stellar-forge/commit/03113810e45d1c622661e7b3e6a9d19222d302a1))
- Burn Tokens UI with danger-zone styling and safety confirmation ([#675](https://github.com/ignaciojulio/Stellar-forge/issues/675)) ([f894e11](https://github.com/ignaciojulio/Stellar-forge/commit/f894e116c013786ca1ddd4bce9a7af607a96c418))
- **burn:** add data-testid attributes for balance display, Max button, and validation error ([0c72f14](https://github.com/ignaciojulio/Stellar-forge/commit/0c72f141647c5c6b77faca6fbd4ea22c696d4b5e)), closes [#755](https://github.com/ignaciojulio/Stellar-forge/issues/755) [#755](https://github.com/ignaciojulio/Stellar-forge/issues/755)
- **ci:** add access-control documentation drift check ([#1112](https://github.com/ignaciojulio/Stellar-forge/issues/1112)) ([#1148](https://github.com/ignaciojulio/Stellar-forge/issues/1148)) ([7b41cfd](https://github.com/ignaciojulio/Stellar-forge/commit/7b41cfda11bb62a91fc6bbcfbfd5bf3063f69f9f))
- **ci:** add reproducible WASM hash verification workflow for mainnet deployments ([#950](https://github.com/ignaciojulio/Stellar-forge/issues/950)) ([abcdbce](https://github.com/ignaciojulio/Stellar-forge/commit/abcdbceaf28f24c23aaa963bf69c9a0b27b47fd5)), closes [#940](https://github.com/ignaciojulio/Stellar-forge/issues/940)
- comprehensive contract tests + fix lib.rs compilation errors ([#677](https://github.com/ignaciojulio/Stellar-forge/issues/677)) ([83a8f8f](https://github.com/ignaciojulio/Stellar-forge/commit/83a8f8f55ddbdd49046ce8ddb84be53360e16699))
- **contract:** add batch token creation ([#487](https://github.com/ignaciojulio/Stellar-forge/issues/487)) ([b50b182](https://github.com/ignaciojulio/Stellar-forge/commit/b50b18207842a21052d69f1a85c67f893e36231a))
- **contract:** add optional max supply cap to tokens ([#483](https://github.com/ignaciojulio/Stellar-forge/issues/483)) ([dc00eb6](https://github.com/ignaciojulio/Stellar-forge/commit/dc00eb6f44e00cdc437c4824c474cb227837dfef))
- **contract:** add treasury fee split mechanism ([#485](https://github.com/ignaciojulio/Stellar-forge/issues/485)) ([d933acf](https://github.com/ignaciojulio/Stellar-forge/commit/d933acfc8876eb3f0db155a0ec7149d04bc2b323))
- **contract:** emit events for all state-changing functions ([#482](https://github.com/ignaciojulio/Stellar-forge/issues/482)) ([0a375a8](https://github.com/ignaciojulio/Stellar-forge/commit/0a375a8a115d2c580d2c1e801e6936102eba4d19))
- **contracts:** add schema versioning and implement migrate ([7293485](https://github.com/ignaciojulio/Stellar-forge/commit/7293485078366ff93f43ebb358360ad335dbde12))
- **contracts:** add schema versioning and implement migrate ([a9fbd2e](https://github.com/ignaciojulio/Stellar-forge/commit/a9fbd2e525ce9f459d28cfdbc126c3a50ab68919))
- create WalletConnectButton component ([766c6b9](https://github.com/ignaciojulio/Stellar-forge/commit/766c6b92eb995d711458cf20585591120ced5d91))
- enable TypeScript strict mode ([#531](https://github.com/ignaciojulio/Stellar-forge/issues/531)) ([bb3ad84](https://github.com/ignaciojulio/Stellar-forge/commit/bb3ad84b61317ddca30bc365f9eb93d4bfc76b28))
- enforce u128 for initial_supply and add InvalidTokenParams validation [#517](https://github.com/ignaciojulio/Stellar-forge/issues/517) ([67582a3](https://github.com/ignaciojulio/Stellar-forge/commit/67582a37491bb016ab44a09f6539321b776a29d0))
- enhance security, add contract upgrade support, and integrate E2E tests into CI ([5695ca0](https://github.com/ignaciojulio/Stellar-forge/commit/5695ca0f03c7e7473d50b32cc8be6ca7c41ea560))
- enhance token factory with DataKey enum and update storage access ([e0c24c0](https://github.com/ignaciojulio/Stellar-forge/commit/e0c24c04b0f0a9c6b9ea74afd0778915d2256a6f))
- **explorer:** add Stellar Expert deep links for accounts, transactions, and contracts ([6d509a4](https://github.com/ignaciojulio/Stellar-forge/commit/6d509a4719802c15ba7a25454bd1cb63e51f4fdc))
- extract contract error mapping to contractErrors.ts ([0420e56](https://github.com/ignaciojulio/Stellar-forge/commit/0420e56d1fa61c2f6923fd51f34e199f9d0aa058))
- **factory:** add offset/limit pagination to get_tokens_by_creator ([#729](https://github.com/ignaciojulio/Stellar-forge/issues/729)) ([3f88aae](https://github.com/ignaciojulio/Stellar-forge/commit/3f88aaeb44917ccbcc07bfa5bb6c8fa8c69f1bec))
- **frontend:** add ipfs gateway URL resolver and stabilize frontend checks ([005ff3f](https://github.com/ignaciojulio/Stellar-forge/commit/005ff3f36d8e792c1aae283a908f8e34f4540440))
- **frontend:** block writes on network mismatch in metadata + admin forms ([#906](https://github.com/ignaciojulio/Stellar-forge/issues/906)) ([f6e88f3](https://github.com/ignaciojulio/Stellar-forge/commit/f6e88f390e3f87e5abd34ce35989c5907b83bd98))
- **frontend:** implement i18n support with es and pt translations ([dcbc1b2](https://github.com/ignaciojulio/Stellar-forge/commit/dcbc1b2838650f7d285d92ffec61a226f0dd28df))
- **frontend:** implement paginated global token listing (getAllTokens) ([#1028](https://github.com/ignaciojulio/Stellar-forge/issues/1028)) ([0e1b51e](https://github.com/ignaciojulio/Stellar-forge/commit/0e1b51e2590b3c23468f893f13e77e5f2eeb592a)), closes [#1017](https://github.com/ignaciojulio/Stellar-forge/issues/1017)
- **frontend:** verify deployed token WASM hash against factory state ([#986](https://github.com/ignaciojulio/Stellar-forge/issues/986)) ([6d1566a](https://github.com/ignaciojulio/Stellar-forge/commit/6d1566a8416e1ac44860fbb6a1395e062548141a)), closes [#925](https://github.com/ignaciojulio/Stellar-forge/issues/925) [hi#severity](https://github.com/hi/issues/severity) [#982](https://github.com/ignaciojulio/Stellar-forge/issues/982) [#984](https://github.com/ignaciojulio/Stellar-forge/issues/984) [#984](https://github.com/ignaciojulio/Stellar-forge/issues/984) [#984](https://github.com/ignaciojulio/Stellar-forge/issues/984) [#982](https://github.com/ignaciojulio/Stellar-forge/issues/982)
- **frontend:** wire network-mismatch banner + FAQ page, drop dead duplicate, fix repo URLs ([901021f](https://github.com/ignaciojulio/Stellar-forge/commit/901021f9ce8eac98d3d50bf5970006818bd835f8))
- gate wallet and metadata actions behind ToS ([8318679](https://github.com/ignaciojulio/Stellar-forge/commit/8318679a05a77d2324ef1032e5a8735df50de38b))
- global error boundary, toast system, and service error cleanup ([19dbf05](https://github.com/ignaciojulio/Stellar-forge/commit/19dbf055d8666ad6c29cfb08330d54dba1c37da2))
- global error boundary, toast system, and service error cleanup ([6ca83ad](https://github.com/ignaciojulio/Stellar-forge/commit/6ca83ad43e48b722d1decf01505c7df900926b39))
- **hooks:** add LRU eviction to useTokens module-level cache ([#967](https://github.com/ignaciojulio/Stellar-forge/issues/967)) ([25ca799](https://github.com/ignaciojulio/Stellar-forge/commit/25ca799e4b03c97a3d52752f7ccbdda0e0820816))
- **hooks:** add useTransaction hook for transaction lifecycle ([#489](https://github.com/ignaciojulio/Stellar-forge/issues/489)) ([18debc3](https://github.com/ignaciojulio/Stellar-forge/commit/18debc33c6bc0dd55ebb830be061c32663b9b2bd))
- implement BigInt-safe formatting utilities ([fc30b37](https://github.com/ignaciojulio/Stellar-forge/commit/fc30b3739e3829c47c164b5fc3ed766a720160e7))
- implement burn_enabled per-token flag ([7d265e8](https://github.com/ignaciojulio/Stellar-forge/commit/7d265e844a3490af982d1665e0d6d17287a21ad1))
- Implement Freighter Wallet Integration ([b91a66e](https://github.com/ignaciojulio/Stellar-forge/commit/b91a66ea7d8ca5e98b04da98c036bde9103896a8))
- implement Freighter wallet integration ([#666](https://github.com/ignaciojulio/Stellar-forge/issues/666)) ([8416cfd](https://github.com/ignaciojulio/Stellar-forge/commit/8416cfd8dd76863b1142ec6662bd063a5eb5c2c8))
- implement global error boundary ([#473](https://github.com/ignaciojulio/Stellar-forge/issues/473)) ([d83fe50](https://github.com/ignaciojulio/Stellar-forge/commit/d83fe50a891c8e6b0ddf9657f533068d85ae8d9d))
- implement Horizon API retry logic with exponential backoff and Retry-After handling [#499](https://github.com/ignaciojulio/Stellar-forge/issues/499) ([cfd31b5](https://github.com/ignaciojulio/Stellar-forge/commit/cfd31b5b7d3cb95c5a4ac367ed93ec95da884a5f))
- implement mobile-responsive design for all components ([cfdf285](https://github.com/ignaciojulio/Stellar-forge/commit/cfdf285acfd73648d3ddb9189c9603994e422016))
- implement pagination for token dashboard ([#29](https://github.com/ignaciojulio/Stellar-forge/issues/29)) ([9aa41b1](https://github.com/ignaciojulio/Stellar-forge/commit/9aa41b1489fc9a4b07d3be68c6f2521197a402f0))
- implement Pinata IPFS upload service with tests ([6b33365](https://github.com/ignaciojulio/Stellar-forge/commit/6b33365592b88e4835ff4b0728bfd33fe5c65504))
- implement Pinata IPFS upload with progress tracking and error handling ([53b3684](https://github.com/ignaciojulio/Stellar-forge/commit/53b368444cefd75a4ab1ae0ad0856244b78d0d59))
- implement responsive mobile layout (issue [#616](https://github.com/ignaciojulio/Stellar-forge/issues/616)) ([49ddf41](https://github.com/ignaciojulio/Stellar-forge/commit/49ddf41412597f035283a56ce005728838a7bf8e))
- implement reusable CopyButton component with Clipboard API integration ([2f8b716](https://github.com/ignaciojulio/Stellar-forge/commit/2f8b71673d4bcfed75cea83aba41ba75c7d39d59))
- implement Soroban contract invocation logic in StellarService ([3a4af37](https://github.com/ignaciojulio/Stellar-forge/commit/3a4af37b668bc7dd633dca8f80ab34230a160da8))
- implement Soroban RPC interactions in stellar.ts ([42c9d18](https://github.com/ignaciojulio/Stellar-forge/commit/42c9d18240eccc884dcee88d0e56e1897fe2a7de))
- implement StellarService with full Soroban RPC integration ([3f0a520](https://github.com/ignaciojulio/Stellar-forge/commit/3f0a52060e1264e34239d59ede6542c9a2791bf6))
- implement token burn UI and service ([a199523](https://github.com/ignaciojulio/Stellar-forge/commit/a19952319a4e6efc77ccf128bd72ac0fe6fdc2e3))
- implement Token Dashboard page ([#673](https://github.com/ignaciojulio/Stellar-forge/issues/673)) ([c3b204c](https://github.com/ignaciojulio/Stellar-forge/commit/c3b204c15fcca7827fd91c69f97cc0708395e3a8))
- implement token detail page ([a79ef19](https://github.com/ignaciojulio/Stellar-forge/commit/a79ef19b62d87c742306511e4c6d4194f47f4301))
- implement TokenDashboard page with TokenCard component and index-based pagination ([4af373b](https://github.com/ignaciojulio/Stellar-forge/commit/4af373b0d6ae3928d8c9f09f6fec2e181c1fd857))
- implement TokenDetail page ([#470](https://github.com/ignaciojulio/Stellar-forge/issues/470)) ([71ca751](https://github.com/ignaciojulio/Stellar-forge/commit/71ca75186290f61636b5217b0e4817d8d70d5860))
- implement TokenDetail page with IPFS metadata, mint/burn/set-metadata inline forms, and 404 state ([9c7f0eb](https://github.com/ignaciojulio/Stellar-forge/commit/9c7f0eb21f1218f5ad84e0026eb007b6760fcf49))
- implement transaction status tracking ([#681](https://github.com/ignaciojulio/Stellar-forge/issues/681)) ([3c0a793](https://github.com/ignaciojulio/Stellar-forge/commit/3c0a79320128a7e0ebe31f2c6c2091dedbabc790))
- implement update_treasury in token-factory ([0c381d3](https://github.com/ignaciojulio/Stellar-forge/commit/0c381d364fc58b048d6ac3b5a3c8e2fdb014a4d4))
- implement useLocalStorage for dark mode context and add tests for useDarkMode hook ([f04664c](https://github.com/ignaciojulio/Stellar-forge/commit/f04664cf78bf2f23ca284ae6d8f7807432928a30))
- implement useLocalStorage hook and integrate for Dark Mode, Network, and Language [#518](https://github.com/ignaciojulio/Stellar-forge/issues/518) ([9a25f84](https://github.com/ignaciojulio/Stellar-forge/commit/9a25f843fb0e4aa8c1cd12c84a1e045243386228))
- implement useTokens hook with parallel fetching and cache ([d9cc12d](https://github.com/ignaciojulio/Stellar-forge/commit/d9cc12d47d2b1f03c90a062a7a4c43e5a8b9d16f)), closes [#16](https://github.com/ignaciojulio/Stellar-forge/issues/16)
- implement wallet auto-reconnect and Freighter event listeners ([4cba9dc](https://github.com/ignaciojulio/Stellar-forge/commit/4cba9dc763125c9a8fa920a14aa94eb91f241835))
- integrate Sentry error tracking for failed contract calls ([e0cb9f9](https://github.com/ignaciojulio/Stellar-forge/commit/e0cb9f995c7d04606937ca8c1df0cd923e71c96d)), closes [#757](https://github.com/ignaciojulio/Stellar-forge/issues/757)
- **ipfs:** implement IPFS metadata upload via Pinata ([#669](https://github.com/ignaciojulio/Stellar-forge/issues/669)) ([949bcc3](https://github.com/ignaciojulio/Stellar-forge/commit/949bcc3dc44b247c9fc084edd83cac814a510dd2))
- Mint Tokens UI with RHF validation and token dropdown ([#674](https://github.com/ignaciojulio/Stellar-forge/issues/674)) ([223235d](https://github.com/ignaciojulio/Stellar-forge/commit/223235d8b6d6995d04610e0103b44853d267c4f4))
- mobile responsive design ([90814c2](https://github.com/ignaciojulio/Stellar-forge/commit/90814c291d43fc2cc5cb1082eaedb49d70b8f228))
- **monitoring:** add monitoring docs and sentry dependency ([e043a5c](https://github.com/ignaciojulio/Stellar-forge/commit/e043a5c4778490cdc5f61a5a6a8bec84f04a97e0))
- **monitoring:** add Sentry, uptime monitoring, and health endpoint ([cee6369](https://github.com/ignaciojulio/Stellar-forge/commit/cee6369984c5aa792f631cb2d99f5387f523a675))
- move wallet state to global React Context ([6c24340](https://github.com/ignaciojulio/Stellar-forge/commit/6c243409493ecaf75dcaf7020b07e51fa764489e))
- network switcher with mainnet warning and localStorage persistence ([5fa8531](https://github.com/ignaciojulio/Stellar-forge/commit/5fa8531fe7735ea781dfdcc3d0393e43b2392138))
- pause/unpause factory already implemented; add burn-while-paused test ([#480](https://github.com/ignaciojulio/Stellar-forge/issues/480)) ([4dd54ca](https://github.com/ignaciojulio/Stellar-forge/commit/4dd54cae186d0f659b02c09174ef52b8c45d40bd))
- provide services via StellarContext, re-init on network change ([4f924de](https://github.com/ignaciojulio/Stellar-forge/commit/4f924de5f21060928b716c73263e9dde08eb6232))
- **security:** add Content Security Policy and security headers ([19f0f1f](https://github.com/ignaciojulio/Stellar-forge/commit/19f0f1f1a414ff3aaa40c7d880892ae53d0fb494))
- **security:** add dependency audit and Dependabot configuration ([9f404c1](https://github.com/ignaciojulio/Stellar-forge/commit/9f404c125b296e2693acefd67f2e6c0c1476f987)), closes [hi#severity](https://github.com/hi/issues/severity) [#502](https://github.com/ignaciojulio/Stellar-forge/issues/502)
- **security:** add strict CSP, X-Frame-Options, and X-Content-Type-Options headers ([a625191](https://github.com/ignaciojulio/Stellar-forge/commit/a625191242ad136c2f085d1524916a0781bbc0ea))
- **security:** add triage and waiver workflow for audit findings ([#981](https://github.com/ignaciojulio/Stellar-forge/issues/981)) ([aa0ceab](https://github.com/ignaciojulio/Stellar-forge/commit/aa0ceab6d134bb7706f4bdb03f4e591bc5eba1ee)), closes [hi#or-above](https://github.com/hi/issues/or-above) [#939](https://github.com/ignaciojulio/Stellar-forge/issues/939)
- show pre-signature fee recipient breakdown and batch total (Closes [#1108](https://github.com/ignaciojulio/Stellar-forge/issues/1108)) ([#1124](https://github.com/ignaciojulio/Stellar-forge/issues/1124)) ([f983539](https://github.com/ignaciojulio/Stellar-forge/commit/f983539afe0eccc35503bc0a0378e47f0f0d70de))
- show XLM/USD equivalent in FeeDisplay component ([fd3c20d](https://github.com/ignaciojulio/Stellar-forge/commit/fd3c20d6172b5f12542e4822efc0e193e64b9f37)), closes [#733](https://github.com/ignaciojulio/Stellar-forge/issues/733)
- toast notification system already implemented ([#474](https://github.com/ignaciojulio/Stellar-forge/issues/474)) ([73b04c9](https://github.com/ignaciojulio/Stellar-forge/commit/73b04c93422a042df4c9343a024b0d799f062b65))
- **token-factory:** validate create_token params and use InvalidParameters error ([4e7abc4](https://github.com/ignaciojulio/Stellar-forge/commit/4e7abc445ef9bb859033a1154087f4e06c60d426))
- **ui:** add DropZone drag-and-drop component and replace file input in MetadataUploadForm ([fee9791](https://github.com/ignaciojulio/Stellar-forge/commit/fee979106b6aa2f6cabdae7a8d89e34187fb4516))
- **ui:** add network-aware Stellar Expert explorer links ([20dced8](https://github.com/ignaciojulio/Stellar-forge/commit/20dced85535f61c3700295b38486148e21fcee85)), closes [#621](https://github.com/ignaciojulio/Stellar-forge/issues/621)
- **ui:** confirmation modal before every state-changing transaction ([#490](https://github.com/ignaciojulio/Stellar-forge/issues/490)) ([88291e3](https://github.com/ignaciojulio/Stellar-forge/commit/88291e3a54fb6581068f0aa474301effc8d5839f))
- **ui:** implement MetadataForm with IPFS upload + Stellar linking ([#676](https://github.com/ignaciojulio/Stellar-forge/issues/676)) ([20f5327](https://github.com/ignaciojulio/Stellar-forge/commit/20f53270a24aafadba31984dde41b3b1f4605ad7))
- upgrade mechanism, ADRs, QR code sharing, onboarding tutorial ([7b59535](https://github.com/ignaciojulio/Stellar-forge/commit/7b5953553e50e0d011aefd8d581d346cd03eef0d)), closes [#1](https://github.com/ignaciojulio/Stellar-forge/issues/1) [#2](https://github.com/ignaciojulio/Stellar-forge/issues/2) [#3](https://github.com/ignaciojulio/Stellar-forge/issues/3) [#4](https://github.com/ignaciojulio/Stellar-forge/issues/4)
- **ux:** insufficient balance warning before transaction submission ([#496](https://github.com/ignaciojulio/Stellar-forge/issues/496)) ([0777d93](https://github.com/ignaciojulio/Stellar-forge/commit/0777d937bf16c0428cc0c9b8981bcf6322cfba66))
- wire setMetadata to StellarService in TokenDetail ([04de946](https://github.com/ignaciojulio/Stellar-forge/commit/04de946b9f1be0b11b385f12dd0138798cb79437))
- wire up mint and burn token UI to contract ([ca6b7b4](https://github.com/ignaciojulio/Stellar-forge/commit/ca6b7b41537ff00ac62d56316089355f62a6b188)), closes [#541](https://github.com/ignaciojulio/Stellar-forge/issues/541)

### Performance Improvements

- apply useMemo, useCallback, and React.memo for render optimizations ([8afb78a](https://github.com/ignaciojulio/Stellar-forge/commit/8afb78ab2911e0681f21866959e39a6fbf41e427))
- fetch creator token pages concurrently with capped concurrency ([#969](https://github.com/ignaciojulio/Stellar-forge/issues/969)) ([bfdc828](https://github.com/ignaciojulio/Stellar-forge/commit/bfdc8285861c5382f87933f48f45c85dfdc50c5d)), closes [#16](https://github.com/ignaciojulio/Stellar-forge/issues/16)
- **frontend:** implement route-level code splitting and lazy load stellar-sdk ([a9ed488](https://github.com/ignaciojulio/Stellar-forge/commit/a9ed488c4633a910765ae678de6f5cc63589a4e2))
- **api:** correct Freighter SEP-53 signature verification in auth challenge ([#1169](https://github.com/Favourorg/Stellar-forge/issues/1169)) ([21cbed6](https://github.com/Favourorg/Stellar-forge/commit/21cbed64699d8eef3796f7e3d895e4ba93ef427a))

# [1.8.0](https://github.com/Favourorg/Stellar-forge/compare/v1.7.0...v1.8.0) (2026-08-24)

### Features

- add client-side CID verification for metadata integrity ([#1139](https://github.com/Favourorg/Stellar-forge/issues/1139)) ([82e9a1b](https://github.com/Favourorg/Stellar-forge/commit/82e9a1b72bf1c78efede6522669d40707a5f295c))

# [1.7.0](https://github.com/Favourorg/Stellar-forge/compare/v1.6.0...v1.7.0) (2026-08-24)

### Features

- **api:** persist contract events in the indexer store (supersedes [#1138](https://github.com/Favourorg/Stellar-forge/issues/1138)) ([#1154](https://github.com/Favourorg/Stellar-forge/issues/1154)) ([45ad5bc](https://github.com/Favourorg/Stellar-forge/commit/45ad5bc0af5d6a8079746f03ff2399fc47be653b))

# [1.6.0](https://github.com/Favourorg/Stellar-forge/compare/v1.5.11...v1.6.0) (2026-08-24)

### Features

- **ci:** add access-control documentation drift check ([#1112](https://github.com/Favourorg/Stellar-forge/issues/1112)) ([#1148](https://github.com/Favourorg/Stellar-forge/issues/1148)) ([7b41cfd](https://github.com/Favourorg/Stellar-forge/commit/7b41cfda11bb62a91fc6bbcfbfd5bf3063f69f9f))

## [1.5.11](https://github.com/Favourorg/Stellar-forge/compare/v1.5.10...v1.5.11) (2026-08-24)

### Bug Fixes

- reclaim orphaned IPFS pins on failed set_metadata (Closes [#1096](https://github.com/Favourorg/Stellar-forge/issues/1096)) ([#1146](https://github.com/Favourorg/Stellar-forge/issues/1146)) ([d845880](https://github.com/Favourorg/Stellar-forge/commit/d84588094a620097ffcb3d66135201ffedc70ad8))

## [1.5.10](https://github.com/Favourorg/Stellar-forge/compare/v1.5.9...v1.5.10) (2026-08-24)

### Bug Fixes

- **api:** add rate limiting to auth challenge endpoints ([#1144](https://github.com/Favourorg/Stellar-forge/issues/1144)) ([600e8a0](https://github.com/Favourorg/Stellar-forge/commit/600e8a057f98129ad93a520030c3224682da0400)), closes [#1101](https://github.com/Favourorg/Stellar-forge/issues/1101)
- **api:** sanitize lastError in health/indexer to avoid leaking internal error details ([#1143](https://github.com/Favourorg/Stellar-forge/issues/1143)) ([c51d179](https://github.com/Favourorg/Stellar-forge/commit/c51d179b782507f167150b719309715fcf6225d9)), closes [#1103](https://github.com/Favourorg/Stellar-forge/issues/1103)

## [1.5.9](https://github.com/Favourorg/Stellar-forge/compare/v1.5.8...v1.5.9) (2026-08-24)

### Bug Fixes

- **contracts:** fuzz the real burn entrypoint, not a reimplementation ([#1098](https://github.com/Favourorg/Stellar-forge/issues/1098)) ([#1137](https://github.com/Favourorg/Stellar-forge/issues/1137)) ([be8a342](https://github.com/Favourorg/Stellar-forge/commit/be8a3424d514423f9946635ff899440911bd3377))

## [1.5.8](https://github.com/Favourorg/Stellar-forge/compare/v1.5.7...v1.5.8) (2026-08-24)

### Bug Fixes

- isolate per-recipient fee-split transfer failures from aborting the call ([#1136](https://github.com/Favourorg/Stellar-forge/issues/1136)) ([6e68f0d](https://github.com/Favourorg/Stellar-forge/commit/6e68f0d78f1272fa6a31cc6d8cb54859dc9fb83b))

## [1.5.7](https://github.com/Favourorg/Stellar-forge/compare/v1.5.6...v1.5.7) (2026-08-24)

### Bug Fixes

- **contracts:** enforce MAX_BATCH_SIZE cap in create_tokens_batch (Closes [#1100](https://github.com/Favourorg/Stellar-forge/issues/1100)) ([#1135](https://github.com/Favourorg/Stellar-forge/issues/1135)) ([2ba33e5](https://github.com/Favourorg/Stellar-forge/commit/2ba33e5e5516b2e3e66388ebd3dcb4568a3b5a14))

## [1.5.6](https://github.com/Favourorg/Stellar-forge/compare/v1.5.5...v1.5.6) (2026-08-24)

### Bug Fixes

- **infra:** consolidate vercel.json security headers (Closes [#1104](https://github.com/Favourorg/Stellar-forge/issues/1104)) ([#1134](https://github.com/Favourorg/Stellar-forge/issues/1134)) ([fc64bea](https://github.com/Favourorg/Stellar-forge/commit/fc64bea1d5185c43fe289214857246bfe014e51c))

## [1.5.5](https://github.com/Favourorg/Stellar-forge/compare/v1.5.4...v1.5.5) (2026-08-22)

### Bug Fixes

- **api:** store wallet-auth challenges in Vercel KV (Closes [#1091](https://github.com/Favourorg/Stellar-forge/issues/1091)) ([#1132](https://github.com/Favourorg/Stellar-forge/issues/1132)) ([62941bb](https://github.com/Favourorg/Stellar-forge/commit/62941bb0131970c10fc56f5fcf19135eefe8de3f))

## [1.5.4](https://github.com/Favourorg/Stellar-forge/compare/v1.5.3...v1.5.4) (2026-08-22)

### Bug Fixes

- **infra:** schedule the indexer cron in vercel.json (Closes [#1090](https://github.com/Favourorg/Stellar-forge/issues/1090)) ([#1130](https://github.com/Favourorg/Stellar-forge/issues/1130)) ([288d5f3](https://github.com/Favourorg/Stellar-forge/commit/288d5f3b1208405fd08e12342fef2ae58cf25a7b)), closes [#1123](https://github.com/Favourorg/Stellar-forge/issues/1123) [#1124](https://github.com/Favourorg/Stellar-forge/issues/1124) [#1125](https://github.com/Favourorg/Stellar-forge/issues/1125) [#1126](https://github.com/Favourorg/Stellar-forge/issues/1126) [#1126](https://github.com/Favourorg/Stellar-forge/issues/1126) [#1126](https://github.com/Favourorg/Stellar-forge/issues/1126) [#1121](https://github.com/Favourorg/Stellar-forge/issues/1121) [#1121](https://github.com/Favourorg/Stellar-forge/issues/1121)

## [1.5.3](https://github.com/Favourorg/Stellar-forge/compare/v1.5.2...v1.5.3) (2026-08-22)

### Bug Fixes

- **api:** remove clientIp() dead code with inverted XFF parsing (audit [#26](https://github.com/Favourorg/Stellar-forge/issues/26)) ([#1129](https://github.com/Favourorg/Stellar-forge/issues/1129)) ([fa1a888](https://github.com/Favourorg/Stellar-forge/commit/fa1a888c99133d2fafab52f3e79444d1ac188766)), closes [#1101](https://github.com/Favourorg/Stellar-forge/issues/1101)

## [1.5.2](https://github.com/Favourorg/Stellar-forge/compare/v1.5.1...v1.5.2) (2026-08-22)

### Bug Fixes

- **explorer:** snapshot tokenCount once per session to prevent pagination drift ([#1126](https://github.com/Favourorg/Stellar-forge/issues/1126)) ([a27f77b](https://github.com/Favourorg/Stellar-forge/commit/a27f77b8dda5b76feced0cf6baeac7a42a84bcf0))

## [1.5.1](https://github.com/Favourorg/Stellar-forge/compare/v1.5.0...v1.5.1) (2026-08-22)

### Bug Fixes

- align frontend token validation with contract (name ≤ 32 UTF-8 bytes, remove ASCII-only restriction) ([#1125](https://github.com/Favourorg/Stellar-forge/issues/1125)) ([cefa9b9](https://github.com/Favourorg/Stellar-forge/commit/cefa9b9c13bbc7f2b5a770e5376369c4875c3833))

# [1.5.0](https://github.com/Favourorg/Stellar-forge/compare/v1.4.4...v1.5.0) (2026-08-22)

### Features

- show pre-signature fee recipient breakdown and batch total (Closes [#1108](https://github.com/Favourorg/Stellar-forge/issues/1108)) ([#1124](https://github.com/Favourorg/Stellar-forge/issues/1124)) ([f983539](https://github.com/Favourorg/Stellar-forge/commit/f983539afe0eccc35503bc0a0378e47f0f0d70de))

## [1.4.4](https://github.com/Favourorg/Stellar-forge/compare/v1.4.3...v1.4.4) (2026-08-22)

### Bug Fixes

- remove 'unsafe-inline' from CSP style-src (Closes [#1105](https://github.com/Favourorg/Stellar-forge/issues/1105)) ([#1123](https://github.com/Favourorg/Stellar-forge/issues/1123)) ([838129c](https://github.com/Favourorg/Stellar-forge/commit/838129ccc63f862350ac86ee1efcc1ba2ae4a163))

## [1.4.3](https://github.com/Favourorg/Stellar-forge/compare/v1.4.2...v1.4.3) (2026-08-22)

### Bug Fixes

- **specs:** resolve spec stubs and enforce kiro spec documentation ([#1117](https://github.com/Favourorg/Stellar-forge/issues/1117)) ([#1120](https://github.com/Favourorg/Stellar-forge/issues/1120)) ([0875cd2](https://github.com/Favourorg/Stellar-forge/commit/0875cd23e96ae0bb87a7d897418349aaa04b18d8)), closes [#1099](https://github.com/Favourorg/Stellar-forge/issues/1099) [#1107](https://github.com/Favourorg/Stellar-forge/issues/1107) [#1108](https://github.com/Favourorg/Stellar-forge/issues/1108) [#1113](https://github.com/Favourorg/Stellar-forge/issues/1113) [#1118](https://github.com/Favourorg/Stellar-forge/issues/1118)

## [1.4.2](https://github.com/Favourorg/Stellar-forge/compare/v1.4.1...v1.4.2) (2026-08-20)

### Bug Fixes

- relabel TokenDetail Admin field to 'Deployed by' (Closes [#1109](https://github.com/Favourorg/Stellar-forge/issues/1109)) ([#1119](https://github.com/Favourorg/Stellar-forge/issues/1119)) ([5d5df07](https://github.com/Favourorg/Stellar-forge/commit/5d5df075612a6e510448e17087c281d987a36478))

## [1.4.1](https://github.com/Favourorg/Stellar-forge/compare/v1.4.0...v1.4.1) (2026-08-03)

### Bug Fixes

- **build:** build the contract for wasm32v1-none everywhere ([#940](https://github.com/Favourorg/Stellar-forge/issues/940)) ([0aa6df3](https://github.com/Favourorg/Stellar-forge/commit/0aa6df38bc25e5bf1941a7dbbafd12616a108505))
- **security:** stop shipping Pinata credentials in the frontend bundle ([#921](https://github.com/Favourorg/Stellar-forge/issues/921)) ([2a23cad](https://github.com/Favourorg/Stellar-forge/commit/2a23cad10304a6b822720ec0ac4cfe5eb19d3a09))

# [1.4.0](https://github.com/Favourorg/Stellar-forge/compare/v1.3.2...v1.4.0) (2026-08-01)

### Bug Fixes

- **contracts:** close remaining FWC26 audit issues ([787dc22](https://github.com/Favourorg/Stellar-forge/commit/787dc22d4272d0258856b6a31967c164dcefddda)), closes [909-#948](https://github.com/909-/issues/948) [#1022](https://github.com/Favourorg/Stellar-forge/issues/1022) [#910](https://github.com/Favourorg/Stellar-forge/issues/910) [#913](https://github.com/Favourorg/Stellar-forge/issues/913) [#916](https://github.com/Favourorg/Stellar-forge/issues/916) [#943](https://github.com/Favourorg/Stellar-forge/issues/943)
- **frontend:** fix Option encoding, map missing topics, add cap field ([fb3ee73](https://github.com/Favourorg/Stellar-forge/commit/fb3ee73daa47161d932d9f91585762223afa6a1a)), closes [#1022](https://github.com/Favourorg/Stellar-forge/issues/1022) [#917](https://github.com/Favourorg/Stellar-forge/issues/917) [#1022](https://github.com/Favourorg/Stellar-forge/issues/1022) [#943](https://github.com/Favourorg/Stellar-forge/issues/943)

### Features

- **api:** add off-chain contract event indexer ([#943](https://github.com/Favourorg/Stellar-forge/issues/943)) ([19a9544](https://github.com/Favourorg/Stellar-forge/commit/19a9544f64827539f6c763c7f9c5b0df725b3cf0))

## [1.3.2](https://github.com/Favourorg/Stellar-forge/compare/v1.3.1...v1.3.2) (2026-07-28)

### Bug Fixes

- **contract:** close open-proxy hole in burn ([#1021](https://github.com/Favourorg/Stellar-forge/issues/1021)) ([#1059](https://github.com/Favourorg/Stellar-forge/issues/1059)) ([895a621](https://github.com/Favourorg/Stellar-forge/commit/895a6218340f8540b8f961ddf47551c96f1c1dbc))

## [1.3.1](https://github.com/Favourorg/Stellar-forge/compare/v1.3.0...v1.3.1) (2026-07-27)

### Bug Fixes

- **frontend:** handle every sendTransaction status explicitly ([#1020](https://github.com/Favourorg/Stellar-forge/issues/1020)) ([#1058](https://github.com/Favourorg/Stellar-forge/issues/1058)) ([70ebab6](https://github.com/Favourorg/Stellar-forge/commit/70ebab62bea7d7dc887e3ce6852a7f436b023083)), closes [#1056](https://github.com/Favourorg/Stellar-forge/issues/1056) [#1057](https://github.com/Favourorg/Stellar-forge/issues/1057)

# [1.3.0](https://github.com/Favourorg/Stellar-forge/compare/v1.2.0...v1.3.0) (2026-07-27)

### Bug Fixes

- **#1024,#1023:** fee-split edge cases and metadata URI validation ([#1036](https://github.com/Favourorg/Stellar-forge/issues/1036)) ([e3174cb](https://github.com/Favourorg/Stellar-forge/commit/e3174cb0bde98950c3bf7be8b97beb16a8cd8113)), closes [#1024](https://github.com/Favourorg/Stellar-forge/issues/1024) [#1023](https://github.com/Favourorg/Stellar-forge/issues/1023) [#1024](https://github.com/Favourorg/Stellar-forge/issues/1024) [#1023](https://github.com/Favourorg/Stellar-forge/issues/1023)
- **#1024,#1023:** fee-split edge cases and metadata URI validation ([#1037](https://github.com/Favourorg/Stellar-forge/issues/1037)) ([116d025](https://github.com/Favourorg/Stellar-forge/commit/116d0258ba1a58cfb22f5a12de9107b00e0323d5)), closes [#1024](https://github.com/Favourorg/Stellar-forge/issues/1024) [#1023](https://github.com/Favourorg/Stellar-forge/issues/1023) [#1024](https://github.com/Favourorg/Stellar-forge/issues/1024) [#1023](https://github.com/Favourorg/Stellar-forge/issues/1023)
- align adm_upd topic and add CI drift detection ([#1032](https://github.com/Favourorg/Stellar-forge/issues/1032)) ([872baa9](https://github.com/Favourorg/Stellar-forge/commit/872baa9047675607156a731e1c9de78d4e9843fb))
- **contracts:** add distribute_fee test coverage at realistic split sizes ([#918](https://github.com/Favourorg/Stellar-forge/issues/918)) ([#1025](https://github.com/Favourorg/Stellar-forge/issues/1025)) ([f9ec953](https://github.com/Favourorg/Stellar-forge/commit/f9ec95316a5ee9968094f12947f7a088cd2b24d1)), closes [#919](https://github.com/Favourorg/Stellar-forge/issues/919)
- **contracts:** charge exactly the required fee, not fee_payment ([#1035](https://github.com/Favourorg/Stellar-forge/issues/1035)) ([8654767](https://github.com/Favourorg/Stellar-forge/commit/86547670d6b45bf9a967ea59e26813b2670de6b5)), closes [#1007](https://github.com/Favourorg/Stellar-forge/issues/1007) [#1007](https://github.com/Favourorg/Stellar-forge/issues/1007) [#1008](https://github.com/Favourorg/Stellar-forge/issues/1008) [#1008](https://github.com/Favourorg/Stellar-forge/issues/1008)
- **contracts:** make token-factory initialize atomic with deployment ([#1029](https://github.com/Favourorg/Stellar-forge/issues/1029)) ([3e12de2](https://github.com/Favourorg/Stellar-forge/commit/3e12de21ff69c7998ff0ad591bc8f066009e364f)), closes [#1005](https://github.com/Favourorg/Stellar-forge/issues/1005)
- **contracts:** move per-token bookkeeping to persistent storage ([#1034](https://github.com/Favourorg/Stellar-forge/issues/1034)) ([51c52bd](https://github.com/Favourorg/Stellar-forge/commit/51c52bd1bcb07eeda1744cd99f82a2816db6aa27)), closes [#1007](https://github.com/Favourorg/Stellar-forge/issues/1007) [#1007](https://github.com/Favourorg/Stellar-forge/issues/1007)
- **contracts:** prove multi-step migrate pattern with synthetic v2 tests ([#919](https://github.com/Favourorg/Stellar-forge/issues/919)) ([#1026](https://github.com/Favourorg/Stellar-forge/issues/1026)) ([f9ef384](https://github.com/Favourorg/Stellar-forge/commit/f9ef3849f30d7af08473cd66268c0692def6da91)), closes [#918](https://github.com/Favourorg/Stellar-forge/issues/918) [#918](https://github.com/Favourorg/Stellar-forge/issues/918)
- **contracts:** repair broken merge artifacts on main ([#1041](https://github.com/Favourorg/Stellar-forge/issues/1041)) ([6524e58](https://github.com/Favourorg/Stellar-forge/commit/6524e58d86b00235622cb07e89d30a756df69f8e)), closes [1034/#1035](https://github.com/Favourorg/Stellar-forge/issues/1035) [#1033](https://github.com/Favourorg/Stellar-forge/issues/1033) [#1034](https://github.com/Favourorg/Stellar-forge/issues/1034) [#1025](https://github.com/Favourorg/Stellar-forge/issues/1025)
- **contracts:** seed max-supply counter with initial_supply ([#1006](https://github.com/Favourorg/Stellar-forge/issues/1006)) ([#1031](https://github.com/Favourorg/Stellar-forge/issues/1031)) ([4a3e90d](https://github.com/Favourorg/Stellar-forge/commit/4a3e90de113d45a28f67c765c4a7c07af38c7e44))
- **frontend:** resolve token identity from contract, not events ([#1018](https://github.com/Favourorg/Stellar-forge/issues/1018)) ([#1030](https://github.com/Favourorg/Stellar-forge/issues/1030)) ([66bcb19](https://github.com/Favourorg/Stellar-forge/commit/66bcb1915e5199371a1b49f5b353e0aba0dfd86a))
- **security:** validate uploaded image content, not client-declared M… ([#1055](https://github.com/Favourorg/Stellar-forge/issues/1055)) ([ab1f253](https://github.com/Favourorg/Stellar-forge/commit/ab1f25398d2c0a1c2a1a6418364423e5a0dfe577)), closes [#1002](https://github.com/Favourorg/Stellar-forge/issues/1002) [#1002](https://github.com/Favourorg/Stellar-forge/issues/1002) [#1056](https://github.com/Favourorg/Stellar-forge/issues/1056) [#1057](https://github.com/Favourorg/Stellar-forge/issues/1057)
- **token-factory:** bound fee-split recipient count to prevent resource-exhaustion griefing ([#1027](https://github.com/Favourorg/Stellar-forge/issues/1027)) ([becd28f](https://github.com/Favourorg/Stellar-forge/commit/becd28f8647eef2fa7e62a9d42b9626413c00216))

### Features

- **frontend:** implement paginated global token listing (getAllTokens) ([#1028](https://github.com/Favourorg/Stellar-forge/issues/1028)) ([0e1b51e](https://github.com/Favourorg/Stellar-forge/commit/0e1b51e2590b3c23468f893f13e77e5f2eeb592a)), closes [#1017](https://github.com/Favourorg/Stellar-forge/issues/1017)

# [1.2.0](https://github.com/Favourorg/Stellar-forge/compare/v1.1.0...v1.2.0) (2026-07-21)

### Bug Fixes

- **deps:** add Dependabot fuzz coverage and auto-merge policy ([#985](https://github.com/Favourorg/Stellar-forge/issues/985)) ([2247b9f](https://github.com/Favourorg/Stellar-forge/commit/2247b9f0cb3343708d5eebb461280d7e558a5b38)), closes [#941](https://github.com/Favourorg/Stellar-forge/issues/941)

### Features

- **frontend:** verify deployed token WASM hash against factory state ([#986](https://github.com/Favourorg/Stellar-forge/issues/986)) ([6d1566a](https://github.com/Favourorg/Stellar-forge/commit/6d1566a8416e1ac44860fbb6a1395e062548141a)), closes [#925](https://github.com/Favourorg/Stellar-forge/issues/925) [hi#severity](https://github.com/hi/issues/severity) [#982](https://github.com/Favourorg/Stellar-forge/issues/982) [#984](https://github.com/Favourorg/Stellar-forge/issues/984) [#984](https://github.com/Favourorg/Stellar-forge/issues/984) [#984](https://github.com/Favourorg/Stellar-forge/issues/984) [#982](https://github.com/Favourorg/Stellar-forge/issues/982)

# [1.1.0](https://github.com/Favourorg/Stellar-forge/compare/v1.0.0...v1.1.0) (2026-07-20)

### Features

- **security:** add triage and waiver workflow for audit findings ([#981](https://github.com/Favourorg/Stellar-forge/issues/981)) ([aa0ceab](https://github.com/Favourorg/Stellar-forge/commit/aa0ceab6d134bb7706f4bdb03f4e591bc5eba1ee)), closes [hi#or-above](https://github.com/hi/issues/or-above) [#939](https://github.com/Favourorg/Stellar-forge/issues/939)

# 1.0.0 (2026-07-20)

### Bug Fixes

- [#741](https://github.com/Favourorg/Stellar-forge/issues/741) AdminPanel restricted to admin address only ([7b2b8c2](https://github.com/Favourorg/Stellar-forge/commit/7b2b8c23d40955b39ea300acea24cfeef851d32d))
- **#854:** format useTransactionHistory.ts to match project Prettier style (remove semicolons) ([8e7b12b](https://github.com/Favourorg/Stellar-forge/commit/8e7b12b757780a3570ec5b425ba61bcf4a23d6b1)), closes [#854](https://github.com/Favourorg/Stellar-forge/issues/854)
- **#855:** eliminate CSP duplication by generating index.html meta tag from policy.ts ([1dc325a](https://github.com/Favourorg/Stellar-forge/commit/1dc325a503f0f41eb78e5220e1252b4afcb5ee13)), closes [#855](https://github.com/Favourorg/Stellar-forge/issues/855)
- **#932:** consolidate useTransactionPolling into useTransaction.ts ([#956](https://github.com/Favourorg/Stellar-forge/issues/956)) ([28a84b6](https://github.com/Favourorg/Stellar-forge/commit/28a84b67df80e8f6c155e97da6f54704a36113cb)), closes [#932](https://github.com/Favourorg/Stellar-forge/issues/932) [#932](https://github.com/Favourorg/Stellar-forge/issues/932)
- **#944:** add txHash, network, contractId Sentry tagging on transaction failures ([#952](https://github.com/Favourorg/Stellar-forge/issues/952)) ([9c213d0](https://github.com/Favourorg/Stellar-forge/commit/9c213d09b089f5704d2748ccc7e3aa2b4fc18a15)), closes [#944](https://github.com/Favourorg/Stellar-forge/issues/944) [#944](https://github.com/Favourorg/Stellar-forge/issues/944)
- **#945:** document batch resource limits and add frontend size cap ([#953](https://github.com/Favourorg/Stellar-forge/issues/953)) ([8555f65](https://github.com/Favourorg/Stellar-forge/commit/8555f65acc16ff60cd3108eb533d836ca7fcd0f2)), closes [#945](https://github.com/Favourorg/Stellar-forge/issues/945) [#945](https://github.com/Favourorg/Stellar-forge/issues/945)
- **#947:** add incident response runbook and break-glass recovery docs ([#954](https://github.com/Favourorg/Stellar-forge/issues/954)) ([0546342](https://github.com/Favourorg/Stellar-forge/commit/054634208dd995ce8daacbd83199c6c8e3547c2a)), closes [#947](https://github.com/Favourorg/Stellar-forge/issues/947) [#9](https://github.com/Favourorg/Stellar-forge/issues/9) [#947](https://github.com/Favourorg/Stellar-forge/issues/947)
- accept decimals=0 in validateTokenParams ([56cb8d9](https://github.com/Favourorg/Stellar-forge/commit/56cb8d961c2d5e421f5391b6d31587ad52013d4b))
- add bounds validation to token metadata type guard (CWE-1236) ([#964](https://github.com/Favourorg/Stellar-forge/issues/964)) ([ab4cb5c](https://github.com/Favourorg/Stellar-forge/commit/ab4cb5c31ea6ded2673ee8d4dc61d11f2469d5a7))
- add BurnAmountExceedsBalance check in burn function ([1113068](https://github.com/Favourorg/Stellar-forge/commit/1113068ceb02e464c40066021ca24279dc4753ab))
- add CI drift check for contract ABI documentation - Closes [#946](https://github.com/Favourorg/Stellar-forge/issues/946) ([#949](https://github.com/Favourorg/Stellar-forge/issues/949)) ([8e67454](https://github.com/Favourorg/Stellar-forge/commit/8e67454a4a4d41c8fe1232eb0d2faebce79f9c6d))
- add env var validation and misconfiguration screen ([f66f1d5](https://github.com/Favourorg/Stellar-forge/commit/f66f1d5c144e9e96ddb451e4feeffca41e950b3d))
- add esbuild as a direct devDependency for Storybook CI build ([512b11e](https://github.com/Favourorg/Stellar-forge/commit/512b11e8cad65979e4fbbdac073ddb8dc5ba1fa8))
- add formula-injection guard to CSV export (CWE-1236) ([#963](https://github.com/Favourorg/Stellar-forge/issues/963)) ([bff7012](https://github.com/Favourorg/Stellar-forge/commit/bff70125f81172ece961c8c4f9f2a215e6f746ce))
- add missing build step to E2E job, fix sitemap script crash ([535955c](https://github.com/Favourorg/Stellar-forge/commit/535955c34bbd6b3877fde7f5a29b42288352cdcc))
- add missing imports for mobile responsive components ([0b89740](https://github.com/Favourorg/Stellar-forge/commit/0b89740d64d35bfacddd14b8c6b5a7c4933a4c7b))
- add standalone network support and fix E2E test mocks ([a78f8de](https://github.com/Favourorg/Stellar-forge/commit/a78f8deef5c21e74f3b391726a60636692a242c3))
- **analytics:** add opt-out tests, CI bypass check, and compliance ADR ([#965](https://github.com/Favourorg/Stellar-forge/issues/965)) ([180f672](https://github.com/Favourorg/Stellar-forge/commit/180f6725d2f82fa5a068687e428886e85179edd3)), closes [#948](https://github.com/Favourorg/Stellar-forge/issues/948)
- audit follow-ups — restore tx polling backoff, fix wasm target, drop orphan form ([05409eb](https://github.com/Favourorg/Stellar-forge/commit/05409eb55f4e3ff2797fce06d631fc94553a0239)), closes [#852](https://github.com/Favourorg/Stellar-forge/issues/852) [#732](https://github.com/Favourorg/Stellar-forge/issues/732) [813/#814](https://github.com/Favourorg/Stellar-forge/issues/814)
- **ci:** remove continue-on-error from fuzz steps, add PR smoke job ([#937](https://github.com/Favourorg/Stellar-forge/issues/937)) ([#966](https://github.com/Favourorg/Stellar-forge/issues/966)) ([000458f](https://github.com/Favourorg/Stellar-forge/commit/000458f8ffde77f136476ea37f2758169f212e07))
- clear cargo clippy -D warnings findings in token-factory ([2a27a8f](https://github.com/Favourorg/Stellar-forge/commit/2a27a8fff3e0b78b5173696166315c1470211a09))
- complete contract test suite with all error variants covered ([5f8320d](https://github.com/Favourorg/Stellar-forge/commit/5f8320d7b14d3a93339ed3f82779d4763a0717b7))
- **contract:** front-load batch validation and document Soroban transaction atomicity ([#915](https://github.com/Favourorg/Stellar-forge/issues/915)) ([#974](https://github.com/Favourorg/Stellar-forge/issues/974)) ([b60868f](https://github.com/Favourorg/Stellar-forge/commit/b60868f0363e8e6c1c89927cfee42fecef7af34a))
- **contracts:** add crash-to-regression-test process with fuzz corpus infrastructure ([#951](https://github.com/Favourorg/Stellar-forge/issues/951)) ([9428b7d](https://github.com/Favourorg/Stellar-forge/commit/9428b7d209366e9ba62ef72359c902cf9beb79b3)), closes [#938](https://github.com/Favourorg/Stellar-forge/issues/938)
- **contracts:** add integer overflow protection in fee arithmetic ([18622f1](https://github.com/Favourorg/Stellar-forge/commit/18622f1777201ba92c4db2ef60928faa4c053de3)), closes [#513](https://github.com/Favourorg/Stellar-forge/issues/513)
- correct useLocalStorage syntax error and variable reference ([232fc52](https://github.com/Favourorg/Stellar-forge/commit/232fc520e4df8a4d1345e67e05084ae32252fe5e))
- dedupe token-validation rules in validation.ts ([d3012c2](https://github.com/Favourorg/Stellar-forge/commit/d3012c2c310f31135a463f13482af36ec9b1dc46)), closes [#845](https://github.com/Favourorg/Stellar-forge/issues/845)
- downgrade vite to v6 for Storybook compatibility ([c2f071b](https://github.com/Favourorg/Stellar-forge/commit/c2f071bb75ced96669d27f11cec13e11d9c83358))
- **e2e:** add token-list-container class and show 6 trailing address chars ([9fcfff3](https://github.com/Favourorg/Stellar-forge/commit/9fcfff3398df79dd9ad987ff4ad51d15409f78b6))
- **e2e:** prevent watcher auto-connect by not responding to REQUEST_NETWORK_DETAILS ([9649702](https://github.com/Favourorg/Stellar-forge/commit/9649702d0793d0e489bb9eb2caba0217f3ab99dc))
- exclude fuzz crate from workspace to prevent wasm32 compilation errors ([b3f09f2](https://github.com/Favourorg/Stellar-forge/commit/b3f09f208486b314a10fd2f8061b90631fa5df3a))
- expand .gitignore to prevent accidental commits of local artifacts ([1da56fe](https://github.com/Favourorg/Stellar-forge/commit/1da56fe00394ccbbff2a86d0de8fa7cf24356924)), closes [#835](https://github.com/Favourorg/Stellar-forge/issues/835)
- **frontend:** clear typecheck errors and prettier drift masked by red CI ([82994b9](https://github.com/Favourorg/Stellar-forge/commit/82994b977781c0b616e68b29fa1e1859765b0ac9))
- **frontend:** close network-mismatch signing window with a fresh pre-sign check ([#961](https://github.com/Favourorg/Stellar-forge/issues/961)) ([7619e99](https://github.com/Favourorg/Stellar-forge/commit/7619e9960d68ad73f6fb67ee0f4f9d11d6ee6ba6)), closes [#927](https://github.com/Favourorg/Stellar-forge/issues/927)
- **frontend:** close unclosed PR wrapper in App.tsx and remove duplicate route entries ([4f9442b](https://github.com/Favourorg/Stellar-forge/commit/4f9442bda20864966521c36f1ed4272c52f56dd2))
- **frontend:** establish transaction reconciliation policy and add phantom-entry guards ([#955](https://github.com/Favourorg/Stellar-forge/issues/955)) ([1372af1](https://github.com/Favourorg/Stellar-forge/commit/1372af165a869a1814ef9b43d22c9e9f507190f2)), closes [#933](https://github.com/Favourorg/Stellar-forge/issues/933)
- **frontend:** filter-aware cache key, stable useCallback deps, re-fetch on filter change ([62d2c8c](https://github.com/Favourorg/Stellar-forge/commit/62d2c8c3aaba49c1099b30db5e3956747b407b9a))
- **frontend:** implement the CSV formula-injection guard its tests expected ([59839b6](https://github.com/Favourorg/Stellar-forge/commit/59839b603cf7a84d782a740ff455e9bc9748ed62)), closes [#963](https://github.com/Favourorg/Stellar-forge/issues/963)
- **frontend:** make token-detail routes public for deep links ([#880](https://github.com/Favourorg/Stellar-forge/issues/880)) ([971e14b](https://github.com/Favourorg/Stellar-forge/commit/971e14b24097a4f08688b097225728ed22955c6e))
- **frontend:** only mount OnboardingModal on Help click, not first-visit ([87d3ce4](https://github.com/Favourorg/Stellar-forge/commit/87d3ce41a764067f90f0384ce795f6111fdcaeec))
- **frontend:** paginate factory event fetch instead of silently capping "all tokens" ([#962](https://github.com/Favourorg/Stellar-forge/issues/962)) ([b480f56](https://github.com/Favourorg/Stellar-forge/commit/b480f56b8f935802aab26d2384efcb3eb3da9080)), closes [#35](https://github.com/Favourorg/Stellar-forge/issues/35)
- **frontend:** pay real base_fee, surface FeeDisplay in mint, block writes on network mismatch ([6d5697d](https://github.com/Favourorg/Stellar-forge/commit/6d5697d3f661be16c4fefccdb1a71f5b5d35734b))
- **frontend:** remove exhaustive-deps suppressions, fix dep arrays ([a8fcf34](https://github.com/Favourorg/Stellar-forge/commit/a8fcf3463afe36bacf28f5f1f259eb5f8e7ca845))
- **frontend:** resolve merge fallout — format, getMetadata validation, no-this-alias ([4e0d770](https://github.com/Favourorg/Stellar-forge/commit/4e0d77063f0d8b10f23cc9176ea2217bf9337b08))
- **frontend:** source FeeDisplay fees from useFactoryState, not the singleton ([e388e7a](https://github.com/Favourorg/Stellar-forge/commit/e388e7aacaf66708e01aba263121bd9b932895b2))
- **frontend:** stop passing a decimal XLM string to formatXLM ([d23be61](https://github.com/Favourorg/Stellar-forge/commit/d23be616d378af583289ce5544de20673eeb5fda))
- **frontend:** track Horizon paging_token and pass cursor on load-more ([aa6e15b](https://github.com/Favourorg/Stellar-forge/commit/aa6e15b235bda5842fed1e8aa5848a2e06b04959))
- **frontend:** unify transaction poll backoff into shared utility ([#960](https://github.com/Favourorg/Stellar-forge/issues/960)) ([2ad85fc](https://github.com/Favourorg/Stellar-forge/commit/2ad85fc7f43c40a66746519eccaf89cb5147e53c))
- **frontend:** wire orphaned features, fix standalone network, add typecheck gate ([c14d1b1](https://github.com/Favourorg/Stellar-forge/commit/c14d1b108ef210ede1d007f231cd4797f844fe26))
- **ipfs:** retry image upload on transient Pinata errors ([26a2005](https://github.com/Favourorg/Stellar-forge/commit/26a2005ebfbe5c27c7f132c3f0a031d5c750ac30)), closes [#743](https://github.com/Favourorg/Stellar-forge/issues/743)
- **ipfs:** validate getMetadata response shape before returning ([7183346](https://github.com/Favourorg/Stellar-forge/commit/71833467e8e0aa7c8a770d2905056227e721378c)), closes [#849](https://github.com/Favourorg/Stellar-forge/issues/849)
- make all 202 tests pass ([1043432](https://github.com/Favourorg/Stellar-forge/commit/1043432dcdf6307385661d7261fd8f73bcae6923))
- pin esbuild/globals devDeps and apply npm audit fixes ([6ccd8c3](https://github.com/Favourorg/Stellar-forge/commit/6ccd8c3418b8617052bd8c290231cabad9d82119))
- provide VITE_TOKEN_WASM_HASH in E2E CI job ([64c1a5b](https://github.com/Favourorg/Stellar-forge/commit/64c1a5b24f90f4685b1690b8653e620768924240))
- real bugs surfaced while restoring lint/test coverage ([8434f56](https://github.com/Favourorg/Stellar-forge/commit/8434f5688c3f8877513c5931eef26bf93b85091f))
- redesign fee transfer and token deployment per issue spec ([e7b8c9e](https://github.com/Favourorg/Stellar-forge/commit/e7b8c9e7f0a77cb618b39afa0b91ea6ac87c5b21))
- refactor build system, fix contract errors, fix dark mode toggle ([85751f8](https://github.com/Favourorg/Stellar-forge/commit/85751f85239640acbae8197feccb14ff63724c16))
- **release:** add @actions/io to satisfy @actions/exec's undeclared import ([cd21fdc](https://github.com/Favourorg/Stellar-forge/commit/cd21fdc70110759165e95d85803d48f15dd7225f))
- **release:** disable husky hooks in the release workflow ([5429060](https://github.com/Favourorg/Stellar-forge/commit/5429060a58cf30265f835f3954a420de043452df))
- repair local Stellar network startup in E2E CI job ([5aa9026](https://github.com/Favourorg/Stellar-forge/commit/5aa90265077404369cfe81c6a96eb94017075893))
- replace console.error with logger in CreateToken, TokenForm, MetadataUploadForm ([24805af](https://github.com/Favourorg/Stellar-forge/commit/24805af56b93e60392a4817ba8708c29960dd043)), closes [#848](https://github.com/Favourorg/Stellar-forge/issues/848)
- replace invalid checksum address in validation test ([64ac45a](https://github.com/Favourorg/Stellar-forge/commit/64ac45ae4179ede5aa0fce9533ffaae640ef2084))
- resolve build failure blocking strict mode verification ([e3370f5](https://github.com/Favourorg/Stellar-forge/commit/e3370f50dec6af5a2780d35d7e11462ecf0c3145))
- resolve Horizon URL from active network config in useTransactionHistory ([2c25a2d](https://github.com/Favourorg/Stellar-forge/commit/2c25a2d2d3b43a72c5453e84f2e2707b4d443696)), closes [#837](https://github.com/Favourorg/Stellar-forge/issues/837)
- restore ESLint v9 flat config ([a85d008](https://github.com/Favourorg/Stellar-forge/commit/a85d008e18a7f925eff1fd5a7361e624754f28cf))
- **routing:** fix deep-link for /token/:address and add e2e tests ([1eb308a](https://github.com/Favourorg/Stellar-forge/commit/1eb308ab9014c595c30aa3868e9d3e4b87278470))
- stop E2E app crash on unknown network and repair Freighter mock ([232afee](https://github.com/Favourorg/Stellar-forge/commit/232afee01997300d0fb64ebbe5101d9c11c520fb))
- **storybook:** finish the Storybook 10 migration ([a66a453](https://github.com/Favourorg/Stellar-forge/commit/a66a453846c86dd2ee83fcb347380b26af4c66ef)), closes [#893](https://github.com/Favourorg/Stellar-forge/issues/893)
- **token-factory:** enforce strict clippy linting for contract code ([686b143](https://github.com/Favourorg/Stellar-forge/commit/686b143cec68646bffeb75790ac317a450742f1f))
- **token-factory:** extend reentrancy guard to all state-mutating entrypoints ([#972](https://github.com/Favourorg/Stellar-forge/issues/972)) ([45a1a9c](https://github.com/Favourorg/Stellar-forge/commit/45a1a9c1f077d7dbb4e6989ce6ccf42195e88fce))
- **token-factory:** reject negative base_fee and metadata_fee ([#973](https://github.com/Favourorg/Stellar-forge/issues/973)) ([e3cdd5e](https://github.com/Favourorg/Stellar-forge/commit/e3cdd5eb5de4962381800beaa58853b45ee4b46d))
- **token-factory:** store token_wasm_hash in FactoryState ([7de1635](https://github.com/Favourorg/Stellar-forge/commit/7de1635b752553f7166f4e6838620a4dd8d540cc)), closes [#543](https://github.com/Favourorg/Stellar-forge/issues/543)
- **ui:** sanitize and validate token name/symbol inputs ([1e4e2e7](https://github.com/Favourorg/Stellar-forge/commit/1e4e2e74f4f0dec3fa06cd44bc4892e76dd421d7))
- upgrade soroban-sdk to 25.x and fix wasm build ([1e098e1](https://github.com/Favourorg/Stellar-forge/commit/1e098e149830f6a10e319bd4ac26ef6db8c1c13a))
- Use correct validation function name in MetadataUploadForm ([b8802cf](https://github.com/Favourorg/Stellar-forge/commit/b8802cfd55f2f9f80e2ec76387c9d91b14bce9e5))
- use dedicated fee_token for all fee transfers in factory contract ([14db340](https://github.com/Favourorg/Stellar-forge/commit/14db340019273fbbd6538c240d765aba96906ec5))
- use formatXLM and stroopsToXLM in FeeDisplay and add conversion test ([65b5d94](https://github.com/Favourorg/Stellar-forge/commit/65b5d944ea82d68e68dd816830751533bf58eca2))
- validate hexToBytes input is exactly 64 hex chars ([4165f9f](https://github.com/Favourorg/Stellar-forge/commit/4165f9f3a9d7285fe3ae50c5784f257c73d77716)), closes [#836](https://github.com/Favourorg/Stellar-forge/issues/836)
- validate token supply before minting to prevent u128 overflow ([#959](https://github.com/Favourorg/Stellar-forge/issues/959)) ([d4027c8](https://github.com/Favourorg/Stellar-forge/commit/d4027c81e69c2d2434374a41e8d2bd514a647c26)), closes [#909](https://github.com/Favourorg/Stellar-forge/issues/909)
- **validation:** use StrKey checksum validation for Stellar addresses ([c55f0f4](https://github.com/Favourorg/Stellar-forge/commit/c55f0f49232a10494906398930488a8eb7e7f9bc))
- **wallet:** clear all state and token cache on disconnect ([a2b1ed3](https://github.com/Favourorg/Stellar-forge/commit/a2b1ed36c3413c37eca259e389307a2f6f06f556))

### Features

- **#588:** Build Token Creation Form UI ([b13478c](https://github.com/Favourorg/Stellar-forge/commit/b13478ce4ce5f7f5ff75bd629ee82c8e77c6e00b)), closes [#588](https://github.com/Favourorg/Stellar-forge/issues/588)
- **#589:** Implement StellarService Token Deployment ([b186936](https://github.com/Favourorg/Stellar-forge/commit/b18693646c7a9a6826cae19aef04b6b97fe95e16)), closes [#589](https://github.com/Favourorg/Stellar-forge/issues/589)
- **#590:** Implement IPFS Metadata Upload via Pinata ([98e1fc0](https://github.com/Favourorg/Stellar-forge/commit/98e1fc05522b123fdfba8949d4f891d09ca36315)), closes [#590](https://github.com/Favourorg/Stellar-forge/issues/590)
- **#603:** Create Token Detail Page ([a1aa1ec](https://github.com/Favourorg/Stellar-forge/commit/a1aa1ecd6ccad4ec4e2b00a59e706cff4b133c13)), closes [#603](https://github.com/Favourorg/Stellar-forge/issues/603)
- **#604:** Add React Router for Navigation ([be195b5](https://github.com/Favourorg/Stellar-forge/commit/be195b50249bb8d3cfe632338b279ccbab3078c1)), closes [#604](https://github.com/Favourorg/Stellar-forge/issues/604)
- **#606:** Add loading states and skeleton UI ([41111e0](https://github.com/Favourorg/Stellar-forge/commit/41111e0675574976efd551268375a5f5aafa094e)), closes [#606](https://github.com/Favourorg/Stellar-forge/issues/606)
- **#607:** Add environment variable validation on startup ([5e3ff84](https://github.com/Favourorg/Stellar-forge/commit/5e3ff842dee16505f089da8fa8ddf59ff1cbf0aa)), closes [#607](https://github.com/Favourorg/Stellar-forge/issues/607)
- **#734:** Add debounced search and creator address filter to TokenExplorer ([12c703b](https://github.com/Favourorg/Stellar-forge/commit/12c703bf6f4ef881be1aec3fb7a31659182a05fb)), closes [#734](https://github.com/Favourorg/Stellar-forge/issues/734)
- **#fuzz:** add fuzz targets for set_metadata and mint_tokens ([167432d](https://github.com/Favourorg/Stellar-forge/commit/167432dc36b3a44d2fa2b3bcd891af976dc06ab6)), closes [#fuzz](https://github.com/Favourorg/Stellar-forge/issues/fuzz)
- **a11y:** accessibility audit and fixes ([98eb2f7](https://github.com/Favourorg/Stellar-forge/commit/98eb2f7bce43199095257b3f21b29347db71fb7d))
- add accessibility improvements (a11y) ([259d1b0](https://github.com/Favourorg/Stellar-forge/commit/259d1b0ba239906605b10feb7a151deea01bb70b))
- add AddressDisplay component with copy and explorer link ([2ab3bda](https://github.com/Favourorg/Stellar-forge/commit/2ab3bdaa16ba838f6da55e681983df940707cb31))
- add analytics integration spec and scaffolding ([#522](https://github.com/Favourorg/Stellar-forge/issues/522)) ([e4d8902](https://github.com/Favourorg/Stellar-forge/commit/e4d89029fe13ea8a94a574bc2028f9090bc51cc0))
- add CHANGELOG.md and PR template with changelog checklist ([89bb67e](https://github.com/Favourorg/Stellar-forge/commit/89bb67ed0b73c25e9a0fad46554b8ee6c35e17cb))
- add client-side routing with react-router-dom (fixes [#471](https://github.com/Favourorg/Stellar-forge/issues/471)) ([baee94d](https://github.com/Favourorg/Stellar-forge/commit/baee94d5865dea41be3e3a0caa3a70952c8f45b3))
- add comprehensive error handling system ([62b4348](https://github.com/Favourorg/Stellar-forge/commit/62b43485f363fcdd348e518631221dcdedbca452))
- add ConfirmModal before all on-chain transactions ([3cef134](https://github.com/Favourorg/Stellar-forge/commit/3cef134598c07ec70c6c8d7ed84549da9a0c6162))
- add Content-Security-Policy headers ([ef28578](https://github.com/Favourorg/Stellar-forge/commit/ef285786231bd883fab9b5e4f2e369658cb010b4))
- add contract event history with pagination ([0425f56](https://github.com/Favourorg/Stellar-forge/commit/0425f560eb14fe3ab740e9e1726e045d9259772a))
- add contract event indexing spec ([#612](https://github.com/Favourorg/Stellar-forge/issues/612)) ([5952c01](https://github.com/Favourorg/Stellar-forge/commit/5952c015de58f01b79a0a3978f7baa09e1ec8c4c))
- add CopyButton component and integrations [#491](https://github.com/Favourorg/Stellar-forge/issues/491) ([6d16970](https://github.com/Favourorg/Stellar-forge/commit/6d1697051d31d6876a50008a3d7669f69d5315b6))
- add dark mode support with localStorage persistence ([24e96e5](https://github.com/Favourorg/Stellar-forge/commit/24e96e584e68fdf5177d3631d5172f390ed08465))
- add dark mode with system preference, localStorage persistence, and toggle button ([5658728](https://github.com/Favourorg/Stellar-forge/commit/5658728f0ba9b5825e3f002c10a8a381c4434ced))
- add decimals validation for create_token (0-18 inclusive) ([f88ec3c](https://github.com/Favourorg/Stellar-forge/commit/f88ec3c3e3100c34bb383c6b90a92fcb1fd33cc4)), closes [#515](https://github.com/Favourorg/Stellar-forge/issues/515)
- add deploy-contract.sh script for automated contract deployment ([f478eb2](https://github.com/Favourorg/Stellar-forge/commit/f478eb2f264a2ad65366be6217dd897ab5ca1e26))
- add E2E coverage for network mismatch guard across all write forms Closes [#935](https://github.com/Favourorg/Stellar-forge/issues/935) ([#970](https://github.com/Favourorg/Stellar-forge/issues/970)) ([a644ce6](https://github.com/Favourorg/Stellar-forge/commit/a644ce657163e43308840ecb8e4a5582b7046cf7))
- add env variable validation and configuration guide ([98642d9](https://github.com/Favourorg/Stellar-forge/commit/98642d9dd07b242b72fa17f7c71c90749209cf71)), closes [#8](https://github.com/Favourorg/Stellar-forge/issues/8)
- add ErrorBoundary component to catch render errors ([d297816](https://github.com/Favourorg/Stellar-forge/commit/d29781600265a3afc90e905556a2b1c995f2dd29))
- add eslint import order rule spec ([ca4bc6b](https://github.com/Favourorg/Stellar-forge/commit/ca4bc6bad5f926f67845006654a62d413a8d7446))
- add export CSV functionality to TransactionHistory ([637dc7c](https://github.com/Favourorg/Stellar-forge/commit/637dc7cfdb0c15520196983a6f5a87e0504fe0a1))
- add fee bump transaction support ([#63](https://github.com/Favourorg/Stellar-forge/issues/63)) ([9b2b8ea](https://github.com/Favourorg/Stellar-forge/commit/9b2b8ea83cad398c574e53d1b5e50876c58252e7))
- add FeeDisplay component with module-level cache ([e749987](https://github.com/Favourorg/Stellar-forge/commit/e749987653db420fb5261cbe857fb557a697ecd1))
- add formatTimestamp and timeAgo utilities (#issue) ([02f8f30](https://github.com/Favourorg/Stellar-forge/commit/02f8f308f23c64b660d3419496b21085f9f35059)), closes [#issue](https://github.com/Favourorg/Stellar-forge/issues/issue)
- add formatTokenAmount and parseTokenAmount utilities ([1041ada](https://github.com/Favourorg/Stellar-forge/commit/1041ada734af076be7fd095d40e6c87ab39b58ed))
- add French (fr) locale i18n support ([4429f89](https://github.com/Favourorg/Stellar-forge/commit/4429f898c5906e2f42b38d3b3069af5acf8b07bd)), closes [#740](https://github.com/Favourorg/Stellar-forge/issues/740)
- add friendbot banner for testnet ([aece4cb](https://github.com/Favourorg/Stellar-forge/commit/aece4cb99d882cf89cd6e87ba8a97312300ead57))
- add frontend unit tests and fix retry unhandled rejections ([ec4b78b](https://github.com/Favourorg/Stellar-forge/commit/ec4b78b50b9ce92b0c37c64e705b0bd81a0f5f10)), closes [#9](https://github.com/Favourorg/Stellar-forge/issues/9)
- add frontend unit tests for validation utils ([#609](https://github.com/Favourorg/Stellar-forge/issues/609)) ([5ef4995](https://github.com/Favourorg/Stellar-forge/commit/5ef4995f2fce86123490a70b7a320a21ef5cdd19))
- add get_tokens_by_creator view function ([#38](https://github.com/Favourorg/Stellar-forge/issues/38)) ([17b7ae0](https://github.com/Favourorg/Stellar-forge/commit/17b7ae09f4e8bca9660d61389704a18eab50a42f))
- add global toast notification system ([ea22272](https://github.com/Favourorg/Stellar-forge/commit/ea22272f16cffdd0390b85ceb56a54fd0fbf519e))
- Add husky + lint-staged pre-commit hooks ([#59](https://github.com/Favourorg/Stellar-forge/issues/59)) ([b11c468](https://github.com/Favourorg/Stellar-forge/commit/b11c4682e0bf0fbcf4b9885237b135142211c366))
- add Husky pre-commit and pre-push hooks ([#533](https://github.com/Favourorg/Stellar-forge/issues/533)) ([c232169](https://github.com/Favourorg/Stellar-forge/commit/c232169967c5bcf58d07aeb4885efeed39444ce0))
- add i18n foundation with react-i18next ([0f8c270](https://github.com/Favourorg/Stellar-forge/commit/0f8c2706990f5b6b6ce9f4c17876efee909929b1))
- add isValidIPFSUri validation utility and SetMetadataForm ([#33](https://github.com/Favourorg/Stellar-forge/issues/33)) ([5ba129f](https://github.com/Favourorg/Stellar-forge/commit/5ba129f8148add491d6dfd406138a3a3ab3a7f1c))
- add isValidIPFSUri validation utility and SetMetadataForm ([#33](https://github.com/Favourorg/Stellar-forge/issues/33)) ([9e76fc4](https://github.com/Favourorg/Stellar-forge/commit/9e76fc48a45c3512ffcc7e9c5edffae81dd0fdf6))
- Add mainnet deployment checklist modal ([#35](https://github.com/Favourorg/Stellar-forge/issues/35)) ([d3e8f2d](https://github.com/Favourorg/Stellar-forge/commit/d3e8f2dfd04536bc5fede24ca84d1e0d416c8e39))
- add MetadataAlreadySet guard in set_metadata ([ebbdd65](https://github.com/Favourorg/Stellar-forge/commit/ebbdd65360b829419d112b4dc8544c0396502a65))
- add MintForm component with address validation and mintTokens service ([ac9df39](https://github.com/Favourorg/Stellar-forge/commit/ac9df395c2e4b4ad710f86211f0ee626e76238e0))
- add network switching support ([#680](https://github.com/Favourorg/Stellar-forge/issues/680)) ([60e9f3f](https://github.com/Favourorg/Stellar-forge/commit/60e9f3fb185c5be0e93d0763c1ada5c6818ec3f3))
- add OG tags, react-router-dom, clippy CI, and npm ci ([24d091c](https://github.com/Favourorg/Stellar-forge/commit/24d091c957c65e2b03eb374edfeb9f62c780d969)), closes [#54](https://github.com/Favourorg/Stellar-forge/issues/54) [#56](https://github.com/Favourorg/Stellar-forge/issues/56) [#68](https://github.com/Favourorg/Stellar-forge/issues/68) [#85](https://github.com/Favourorg/Stellar-forge/issues/85)
- add pause/unpause admin function to factory contract ([#39](https://github.com/Favourorg/Stellar-forge/issues/39)) ([5a5c965](https://github.com/Favourorg/Stellar-forge/commit/5a5c9657eb01f741a73fd68b07e8c129c0b72494))
- add polling, last-updated indicator, and refresh to transaction history ([ac79943](https://github.com/Favourorg/Stellar-forge/commit/ac799436d088dc8a3876b6b1f8f1f3bda7e57e9e)), closes [#752](https://github.com/Favourorg/Stellar-forge/issues/752)
- add Prettier, fix all TS errors, add CI/CD pipeline, add formatAddress and Checkbox UI component ([a11180e](https://github.com/Favourorg/Stellar-forge/commit/a11180e10be6c60a668889a4ca85c4056e65db23))
- add PWA support with vite-plugin-pwa ([#81](https://github.com/Favourorg/Stellar-forge/issues/81)) ([547110c](https://github.com/Favourorg/Stellar-forge/commit/547110c7a3bf0b9308433e6541a72851315dbc7f))
- add reentrancy guard to create_token with Error::Reentrancy variant ([986de4b](https://github.com/Favourorg/Stellar-forge/commit/986de4be908dde9aca2df9497827bd4e57c72188))
- add reusable Modal base component ([#527](https://github.com/Favourorg/Stellar-forge/issues/527)) ([e19c519](https://github.com/Favourorg/Stellar-forge/commit/e19c519d5362139603878ae605d798d0f32d4885))
- add reusable Modal base component ([#527](https://github.com/Favourorg/Stellar-forge/issues/527)) ([f605b53](https://github.com/Favourorg/Stellar-forge/commit/f605b537b184538356ec3f5dfaf6e77a7023ec68))
- add robots.txt, sitemap.xml, and meta description for SEO ([de6bb1c](https://github.com/Favourorg/Stellar-forge/commit/de6bb1ca190af7144dbcf42c4e375fb037629e40))
- add robust useClipboard hook and refactor dashboard ([7149392](https://github.com/Favourorg/Stellar-forge/commit/7149392879177afb4890d27e84fcafd74993380c)), closes [#26](https://github.com/Favourorg/Stellar-forge/issues/26)
- add secure Admin Panel for factory fee management ([39e28a5](https://github.com/Favourorg/Stellar-forge/commit/39e28a5d8ea44f66da35c9103d0283f8ebbca68a))
- Add security disclosure policy ([#47](https://github.com/Favourorg/Stellar-forge/issues/47)) ([096fcd7](https://github.com/Favourorg/Stellar-forge/commit/096fcd7db59170ab86e51293dfd1c261de5b856c))
- Add Select UI component with accessibility and dark mode support ([412420a](https://github.com/Favourorg/Stellar-forge/commit/412420aaf6de26d11d299790904564aada4d9982))
- add semantic release for automated versioning ([bcd42fe](https://github.com/Favourorg/Stellar-forge/commit/bcd42fe4045889bb25e4c751a1999444d91b9e48))
- add sitemap generation script and update prebuild script to include it ([8948663](https://github.com/Favourorg/Stellar-forge/commit/89486632614de04d357937eebec497dfcd8656bc))
- add skeleton loaders and a11y improvements ([#475](https://github.com/Favourorg/Stellar-forge/issues/475), [#477](https://github.com/Favourorg/Stellar-forge/issues/477)) ([1ea1e54](https://github.com/Favourorg/Stellar-forge/commit/1ea1e54760f52c844e342691ade1968f9d9f3db4))
- add skeleton loaders for TokenExplorer and Dashboard ([42867fe](https://github.com/Favourorg/Stellar-forge/commit/42867fe60d0626302ff16fe9f97da65e7ca44aa9)), closes [#735](https://github.com/Favourorg/Stellar-forge/issues/735)
- add skeleton-loaders spec (requirements, design, tasks) ([ec3a9ed](https://github.com/Favourorg/Stellar-forge/commit/ec3a9edccdea9cb861af1c086b32f0e45188e011))
- add social sharing for newly created tokens ([#521](https://github.com/Favourorg/Stellar-forge/issues/521)) ([7e2cdcc](https://github.com/Favourorg/Stellar-forge/commit/7e2cdcc311980edab824795b7afb3fa37f5bf470))
- add Soroban benchmark harness for resource cost tracking ([#968](https://github.com/Favourorg/Stellar-forge/issues/968)) ([91b504f](https://github.com/Favourorg/Stellar-forge/commit/91b504f5f459c5e5491cf181a30c00c4611bfb1d)), closes [#12](https://github.com/Favourorg/Stellar-forge/issues/12)
- add soroban-token-sdk audit spec ([ae3686a](https://github.com/Favourorg/Stellar-forge/commit/ae3686a6aa6a9ea90c65cdac09212cbc17484e50))
- add stellar contract optimize to deployment workflow ([4a56338](https://github.com/Favourorg/Stellar-forge/commit/4a5633820d68a264160311da5c161e36fa3dec9d))
- add stellarExplorerUrl utility and wire explorer links ([d043699](https://github.com/Favourorg/Stellar-forge/commit/d04369980cab1a6f5a29c557b4857fdec90d0b43))
- add Storybook stories for ConfirmModal, ProgressIndicator, and InsufficientBalanceWarning ([a25343e](https://github.com/Favourorg/Stellar-forge/commit/a25343ef58f82389e1ee34d6e81304cf0bcba9c8))
- add Storybook with stories for all UI components ([564a5b8](https://github.com/Favourorg/Stellar-forge/commit/564a5b8747b18cecec42b800a28dd3b4845a51e6))
- add Terms of Service acceptance modal before first transaction ([#529](https://github.com/Favourorg/Stellar-forge/issues/529)) ([53a7bc8](https://github.com/Favourorg/Stellar-forge/commit/53a7bc8473d5bfc7ddc0b4c8bb6b34d28c6f0b10))
- add Terms of Service acceptance modal before first transaction ([#529](https://github.com/Favourorg/Stellar-forge/issues/529)) ([b2ddf76](https://github.com/Favourorg/Stellar-forge/commit/b2ddf76f997e7098519c2db85ef732176cc34ecf))
- add testnet faucet integration via Friendbot ([#519](https://github.com/Favourorg/Stellar-forge/issues/519)) ([f7c2965](https://github.com/Favourorg/Stellar-forge/commit/f7c29653018bc9422437a517de60b021c9d9fd94))
- add token event history with pagination and event details display ([9196fdf](https://github.com/Favourorg/Stellar-forge/commit/9196fdfa879502ba361811ad750a45319afee0e4))
- add token search, filter, and sort to Dashboard ([a17250a](https://github.com/Favourorg/Stellar-forge/commit/a17250a7e7415c736f7abfb26c24ad63cce35e51))
- add token search, filter, and sort to dashboard ([#64](https://github.com/Favourorg/Stellar-forge/issues/64)) ([eb80749](https://github.com/Favourorg/Stellar-forge/commit/eb80749f6deacb0dab54ba40af95e1d1693cdb81))
- add TokenDashboard with pagination, search, and Explorer links ([d7ce574](https://github.com/Favourorg/Stellar-forge/commit/d7ce574bcb1e0b4670e1cc9c2d895946776aaf1a))
- add TokenExplorer component with search and pagination ([4b21179](https://github.com/Favourorg/Stellar-forge/commit/4b211798c41fbfb492613f48e66a6bb174a37da1))
- add TokenMetadata display component ([658efc0](https://github.com/Favourorg/Stellar-forge/commit/658efc0c1321a6b4794c0682e75894e0a45e66aa))
- Add transaction retry logic with exponential backoff ([#62](https://github.com/Favourorg/Stellar-forge/issues/62)) ([f0d8f02](https://github.com/Favourorg/Stellar-forge/commit/f0d8f02c2d45a8649b21ef2a83f69fc757033bba))
- Add TransactionHistory component and useTransactionHistory hook for Stellar token operations ([f8fed91](https://github.com/Favourorg/Stellar-forge/commit/f8fed914347008992fae259b506952c2d0c7ae88))
- Add TransactionStatus component and tests ([4637fb8](https://github.com/Favourorg/Stellar-forge/commit/4637fb8c495482a5609f2f90ea6a5309aa09dd57))
- add transfer_admin function with tests ([347d54f](https://github.com/Favourorg/Stellar-forge/commit/347d54fbbf885985964f991d51ed4c6807dcd071))
- add TTL management for all Soroban storage writes ([7b34532](https://github.com/Favourorg/Stellar-forge/commit/7b3453265f83cbc0fe7f0dcaf8a736f21902887c))
- add UI barrel export and update all imports ([2e4fbe0](https://github.com/Favourorg/Stellar-forge/commit/2e4fbe0e006564fee5c51396ba9137e9de42793c))
- add update_admin function to token factory contract ([#479](https://github.com/Favourorg/Stellar-forge/issues/479)) ([5db1fe4](https://github.com/Favourorg/Stellar-forge/commit/5db1fe4734dc41788232efd3e11397bf74bd2954))
- add useDebounce hook, apply to MintForm/BurnForm/Dashboard, fix build ([e8727e1](https://github.com/Favourorg/Stellar-forge/commit/e8727e16b4f1c50beca6977389720fe1497b192b))
- add useFactoryState hook, coverage thresholds, and CI workflow ([15b366d](https://github.com/Favourorg/Stellar-forge/commit/15b366d315366e901a05351e7d200da9330bd39d))
- Add useLocalStorage hook and tests ([56eac71](https://github.com/Favourorg/Stellar-forge/commit/56eac719547fd75bdd916da05ab5a8bcde6fc663))
- add useTokenBalance hook and fix TypeScript errors ([43792b7](https://github.com/Favourorg/Stellar-forge/commit/43792b7593c29fff7929ca1c52e9096b32c4e3ef))
- add useTokens pagination and useTokenInfo hook ([a473194](https://github.com/Favourorg/Stellar-forge/commit/a473194fbf697aa6feeed853de1253c30d8947df))
- add VITE_TOKEN_WASM_HASH to env validation and fix duplicate import ([b027cc2](https://github.com/Favourorg/Stellar-forge/commit/b027cc256bc2c3381cedcfab7b48a81805e7f41f))
- add wallet token portfolio dashboard ([cc28ab9](https://github.com/Favourorg/Stellar-forge/commit/cc28ab9f2d9505077bfbc430aac870983c6979f7))
- add WalletButton UI component and integrate into App.tsx header ([cf20f69](https://github.com/Favourorg/Stellar-forge/commit/cf20f695cb93d60d96fa4f5f1592f1395ac2ef4f))
- add wasm-opt post-processing for contract binary ([de1f779](https://github.com/Favourorg/Stellar-forge/commit/de1f779897d4ddbc938d9d1d58e1020d352081a0))
- add whitelist for fee-free token creation ([59c0f59](https://github.com/Favourorg/Stellar-forge/commit/59c0f598ecfd74fa1cfe5a036a8ac22418e0d823))
- build token creation form UI on home page ([#667](https://github.com/Favourorg/Stellar-forge/issues/667)) ([0311381](https://github.com/Favourorg/Stellar-forge/commit/03113810e45d1c622661e7b3e6a9d19222d302a1))
- Burn Tokens UI with danger-zone styling and safety confirmation ([#675](https://github.com/Favourorg/Stellar-forge/issues/675)) ([f894e11](https://github.com/Favourorg/Stellar-forge/commit/f894e116c013786ca1ddd4bce9a7af607a96c418))
- **burn:** add data-testid attributes for balance display, Max button, and validation error ([0c72f14](https://github.com/Favourorg/Stellar-forge/commit/0c72f141647c5c6b77faca6fbd4ea22c696d4b5e)), closes [#755](https://github.com/Favourorg/Stellar-forge/issues/755) [#755](https://github.com/Favourorg/Stellar-forge/issues/755)
- **ci:** add reproducible WASM hash verification workflow for mainnet deployments ([#950](https://github.com/Favourorg/Stellar-forge/issues/950)) ([abcdbce](https://github.com/Favourorg/Stellar-forge/commit/abcdbceaf28f24c23aaa963bf69c9a0b27b47fd5)), closes [#940](https://github.com/Favourorg/Stellar-forge/issues/940)
- comprehensive contract tests + fix lib.rs compilation errors ([#677](https://github.com/Favourorg/Stellar-forge/issues/677)) ([83a8f8f](https://github.com/Favourorg/Stellar-forge/commit/83a8f8f55ddbdd49046ce8ddb84be53360e16699))
- **contract:** add batch token creation ([#487](https://github.com/Favourorg/Stellar-forge/issues/487)) ([b50b182](https://github.com/Favourorg/Stellar-forge/commit/b50b18207842a21052d69f1a85c67f893e36231a))
- **contract:** add optional max supply cap to tokens ([#483](https://github.com/Favourorg/Stellar-forge/issues/483)) ([dc00eb6](https://github.com/Favourorg/Stellar-forge/commit/dc00eb6f44e00cdc437c4824c474cb227837dfef))
- **contract:** add treasury fee split mechanism ([#485](https://github.com/Favourorg/Stellar-forge/issues/485)) ([d933acf](https://github.com/Favourorg/Stellar-forge/commit/d933acfc8876eb3f0db155a0ec7149d04bc2b323))
- **contract:** emit events for all state-changing functions ([#482](https://github.com/Favourorg/Stellar-forge/issues/482)) ([0a375a8](https://github.com/Favourorg/Stellar-forge/commit/0a375a8a115d2c580d2c1e801e6936102eba4d19))
- **contracts:** add schema versioning and implement migrate ([7293485](https://github.com/Favourorg/Stellar-forge/commit/7293485078366ff93f43ebb358360ad335dbde12))
- **contracts:** add schema versioning and implement migrate ([a9fbd2e](https://github.com/Favourorg/Stellar-forge/commit/a9fbd2e525ce9f459d28cfdbc126c3a50ab68919))
- create WalletConnectButton component ([766c6b9](https://github.com/Favourorg/Stellar-forge/commit/766c6b92eb995d711458cf20585591120ced5d91))
- enable TypeScript strict mode ([#531](https://github.com/Favourorg/Stellar-forge/issues/531)) ([bb3ad84](https://github.com/Favourorg/Stellar-forge/commit/bb3ad84b61317ddca30bc365f9eb93d4bfc76b28))
- enforce u128 for initial_supply and add InvalidTokenParams validation [#517](https://github.com/Favourorg/Stellar-forge/issues/517) ([67582a3](https://github.com/Favourorg/Stellar-forge/commit/67582a37491bb016ab44a09f6539321b776a29d0))
- enhance security, add contract upgrade support, and integrate E2E tests into CI ([5695ca0](https://github.com/Favourorg/Stellar-forge/commit/5695ca0f03c7e7473d50b32cc8be6ca7c41ea560))
- enhance token factory with DataKey enum and update storage access ([e0c24c0](https://github.com/Favourorg/Stellar-forge/commit/e0c24c04b0f0a9c6b9ea74afd0778915d2256a6f))
- **explorer:** add Stellar Expert deep links for accounts, transactions, and contracts ([6d509a4](https://github.com/Favourorg/Stellar-forge/commit/6d509a4719802c15ba7a25454bd1cb63e51f4fdc))
- extract contract error mapping to contractErrors.ts ([0420e56](https://github.com/Favourorg/Stellar-forge/commit/0420e56d1fa61c2f6923fd51f34e199f9d0aa058))
- **factory:** add offset/limit pagination to get_tokens_by_creator ([#729](https://github.com/Favourorg/Stellar-forge/issues/729)) ([3f88aae](https://github.com/Favourorg/Stellar-forge/commit/3f88aaeb44917ccbcc07bfa5bb6c8fa8c69f1bec))
- **frontend:** add ipfs gateway URL resolver and stabilize frontend checks ([005ff3f](https://github.com/Favourorg/Stellar-forge/commit/005ff3f36d8e792c1aae283a908f8e34f4540440))
- **frontend:** block writes on network mismatch in metadata + admin forms ([#906](https://github.com/Favourorg/Stellar-forge/issues/906)) ([f6e88f3](https://github.com/Favourorg/Stellar-forge/commit/f6e88f390e3f87e5abd34ce35989c5907b83bd98))
- **frontend:** implement i18n support with es and pt translations ([dcbc1b2](https://github.com/Favourorg/Stellar-forge/commit/dcbc1b2838650f7d285d92ffec61a226f0dd28df))
- **frontend:** wire network-mismatch banner + FAQ page, drop dead duplicate, fix repo URLs ([901021f](https://github.com/Favourorg/Stellar-forge/commit/901021f9ce8eac98d3d50bf5970006818bd835f8))
- gate wallet and metadata actions behind ToS ([8318679](https://github.com/Favourorg/Stellar-forge/commit/8318679a05a77d2324ef1032e5a8735df50de38b))
- global error boundary, toast system, and service error cleanup ([19dbf05](https://github.com/Favourorg/Stellar-forge/commit/19dbf055d8666ad6c29cfb08330d54dba1c37da2))
- global error boundary, toast system, and service error cleanup ([6ca83ad](https://github.com/Favourorg/Stellar-forge/commit/6ca83ad43e48b722d1decf01505c7df900926b39))
- **hooks:** add LRU eviction to useTokens module-level cache ([#967](https://github.com/Favourorg/Stellar-forge/issues/967)) ([25ca799](https://github.com/Favourorg/Stellar-forge/commit/25ca799e4b03c97a3d52752f7ccbdda0e0820816))
- **hooks:** add useTransaction hook for transaction lifecycle ([#489](https://github.com/Favourorg/Stellar-forge/issues/489)) ([18debc3](https://github.com/Favourorg/Stellar-forge/commit/18debc33c6bc0dd55ebb830be061c32663b9b2bd))
- implement BigInt-safe formatting utilities ([fc30b37](https://github.com/Favourorg/Stellar-forge/commit/fc30b3739e3829c47c164b5fc3ed766a720160e7))
- implement burn_enabled per-token flag ([7d265e8](https://github.com/Favourorg/Stellar-forge/commit/7d265e844a3490af982d1665e0d6d17287a21ad1))
- Implement Freighter Wallet Integration ([b91a66e](https://github.com/Favourorg/Stellar-forge/commit/b91a66ea7d8ca5e98b04da98c036bde9103896a8))
- implement Freighter wallet integration ([#666](https://github.com/Favourorg/Stellar-forge/issues/666)) ([8416cfd](https://github.com/Favourorg/Stellar-forge/commit/8416cfd8dd76863b1142ec6662bd063a5eb5c2c8))
- implement global error boundary ([#473](https://github.com/Favourorg/Stellar-forge/issues/473)) ([d83fe50](https://github.com/Favourorg/Stellar-forge/commit/d83fe50a891c8e6b0ddf9657f533068d85ae8d9d))
- implement Horizon API retry logic with exponential backoff and Retry-After handling [#499](https://github.com/Favourorg/Stellar-forge/issues/499) ([cfd31b5](https://github.com/Favourorg/Stellar-forge/commit/cfd31b5b7d3cb95c5a4ac367ed93ec95da884a5f))
- implement mobile-responsive design for all components ([cfdf285](https://github.com/Favourorg/Stellar-forge/commit/cfdf285acfd73648d3ddb9189c9603994e422016))
- implement pagination for token dashboard ([#29](https://github.com/Favourorg/Stellar-forge/issues/29)) ([9aa41b1](https://github.com/Favourorg/Stellar-forge/commit/9aa41b1489fc9a4b07d3be68c6f2521197a402f0))
- implement Pinata IPFS upload service with tests ([6b33365](https://github.com/Favourorg/Stellar-forge/commit/6b33365592b88e4835ff4b0728bfd33fe5c65504))
- implement Pinata IPFS upload with progress tracking and error handling ([53b3684](https://github.com/Favourorg/Stellar-forge/commit/53b368444cefd75a4ab1ae0ad0856244b78d0d59))
- implement responsive mobile layout (issue [#616](https://github.com/Favourorg/Stellar-forge/issues/616)) ([49ddf41](https://github.com/Favourorg/Stellar-forge/commit/49ddf41412597f035283a56ce005728838a7bf8e))
- implement reusable CopyButton component with Clipboard API integration ([2f8b716](https://github.com/Favourorg/Stellar-forge/commit/2f8b71673d4bcfed75cea83aba41ba75c7d39d59))
- implement Soroban contract invocation logic in StellarService ([3a4af37](https://github.com/Favourorg/Stellar-forge/commit/3a4af37b668bc7dd633dca8f80ab34230a160da8))
- implement Soroban RPC interactions in stellar.ts ([42c9d18](https://github.com/Favourorg/Stellar-forge/commit/42c9d18240eccc884dcee88d0e56e1897fe2a7de))
- implement StellarService with full Soroban RPC integration ([3f0a520](https://github.com/Favourorg/Stellar-forge/commit/3f0a52060e1264e34239d59ede6542c9a2791bf6))
- implement token burn UI and service ([a199523](https://github.com/Favourorg/Stellar-forge/commit/a19952319a4e6efc77ccf128bd72ac0fe6fdc2e3))
- implement Token Dashboard page ([#673](https://github.com/Favourorg/Stellar-forge/issues/673)) ([c3b204c](https://github.com/Favourorg/Stellar-forge/commit/c3b204c15fcca7827fd91c69f97cc0708395e3a8))
- implement token detail page ([a79ef19](https://github.com/Favourorg/Stellar-forge/commit/a79ef19b62d87c742306511e4c6d4194f47f4301))
- implement TokenDashboard page with TokenCard component and index-based pagination ([4af373b](https://github.com/Favourorg/Stellar-forge/commit/4af373b0d6ae3928d8c9f09f6fec2e181c1fd857))
- implement TokenDetail page ([#470](https://github.com/Favourorg/Stellar-forge/issues/470)) ([71ca751](https://github.com/Favourorg/Stellar-forge/commit/71ca75186290f61636b5217b0e4817d8d70d5860))
- implement TokenDetail page with IPFS metadata, mint/burn/set-metadata inline forms, and 404 state ([9c7f0eb](https://github.com/Favourorg/Stellar-forge/commit/9c7f0eb21f1218f5ad84e0026eb007b6760fcf49))
- implement transaction status tracking ([#681](https://github.com/Favourorg/Stellar-forge/issues/681)) ([3c0a793](https://github.com/Favourorg/Stellar-forge/commit/3c0a79320128a7e0ebe31f2c6c2091dedbabc790))
- implement update_treasury in token-factory ([0c381d3](https://github.com/Favourorg/Stellar-forge/commit/0c381d364fc58b048d6ac3b5a3c8e2fdb014a4d4))
- implement useLocalStorage for dark mode context and add tests for useDarkMode hook ([f04664c](https://github.com/Favourorg/Stellar-forge/commit/f04664cf78bf2f23ca284ae6d8f7807432928a30))
- implement useLocalStorage hook and integrate for Dark Mode, Network, and Language [#518](https://github.com/Favourorg/Stellar-forge/issues/518) ([9a25f84](https://github.com/Favourorg/Stellar-forge/commit/9a25f843fb0e4aa8c1cd12c84a1e045243386228))
- implement useTokens hook with parallel fetching and cache ([d9cc12d](https://github.com/Favourorg/Stellar-forge/commit/d9cc12d47d2b1f03c90a062a7a4c43e5a8b9d16f)), closes [#16](https://github.com/Favourorg/Stellar-forge/issues/16)
- implement wallet auto-reconnect and Freighter event listeners ([4cba9dc](https://github.com/Favourorg/Stellar-forge/commit/4cba9dc763125c9a8fa920a14aa94eb91f241835))
- integrate Sentry error tracking for failed contract calls ([e0cb9f9](https://github.com/Favourorg/Stellar-forge/commit/e0cb9f995c7d04606937ca8c1df0cd923e71c96d)), closes [#757](https://github.com/Favourorg/Stellar-forge/issues/757)
- **ipfs:** implement IPFS metadata upload via Pinata ([#669](https://github.com/Favourorg/Stellar-forge/issues/669)) ([949bcc3](https://github.com/Favourorg/Stellar-forge/commit/949bcc3dc44b247c9fc084edd83cac814a510dd2))
- Mint Tokens UI with RHF validation and token dropdown ([#674](https://github.com/Favourorg/Stellar-forge/issues/674)) ([223235d](https://github.com/Favourorg/Stellar-forge/commit/223235d8b6d6995d04610e0103b44853d267c4f4))
- mobile responsive design ([90814c2](https://github.com/Favourorg/Stellar-forge/commit/90814c291d43fc2cc5cb1082eaedb49d70b8f228))
- **monitoring:** add monitoring docs and sentry dependency ([e043a5c](https://github.com/Favourorg/Stellar-forge/commit/e043a5c4778490cdc5f61a5a6a8bec84f04a97e0))
- **monitoring:** add Sentry, uptime monitoring, and health endpoint ([cee6369](https://github.com/Favourorg/Stellar-forge/commit/cee6369984c5aa792f631cb2d99f5387f523a675))
- move wallet state to global React Context ([6c24340](https://github.com/Favourorg/Stellar-forge/commit/6c243409493ecaf75dcaf7020b07e51fa764489e))
- network switcher with mainnet warning and localStorage persistence ([5fa8531](https://github.com/Favourorg/Stellar-forge/commit/5fa8531fe7735ea781dfdcc3d0393e43b2392138))
- pause/unpause factory already implemented; add burn-while-paused test ([#480](https://github.com/Favourorg/Stellar-forge/issues/480)) ([4dd54ca](https://github.com/Favourorg/Stellar-forge/commit/4dd54cae186d0f659b02c09174ef52b8c45d40bd))
- provide services via StellarContext, re-init on network change ([4f924de](https://github.com/Favourorg/Stellar-forge/commit/4f924de5f21060928b716c73263e9dde08eb6232))
- **security:** add Content Security Policy and security headers ([19f0f1f](https://github.com/Favourorg/Stellar-forge/commit/19f0f1f1a414ff3aaa40c7d880892ae53d0fb494))
- **security:** add dependency audit and Dependabot configuration ([9f404c1](https://github.com/Favourorg/Stellar-forge/commit/9f404c125b296e2693acefd67f2e6c0c1476f987)), closes [hi#severity](https://github.com/hi/issues/severity) [#502](https://github.com/Favourorg/Stellar-forge/issues/502)
- **security:** add strict CSP, X-Frame-Options, and X-Content-Type-Options headers ([a625191](https://github.com/Favourorg/Stellar-forge/commit/a625191242ad136c2f085d1524916a0781bbc0ea))
- show XLM/USD equivalent in FeeDisplay component ([fd3c20d](https://github.com/Favourorg/Stellar-forge/commit/fd3c20d6172b5f12542e4822efc0e193e64b9f37)), closes [#733](https://github.com/Favourorg/Stellar-forge/issues/733)
- toast notification system already implemented ([#474](https://github.com/Favourorg/Stellar-forge/issues/474)) ([73b04c9](https://github.com/Favourorg/Stellar-forge/commit/73b04c93422a042df4c9343a024b0d799f062b65))
- **token-factory:** validate create_token params and use InvalidParameters error ([4e7abc4](https://github.com/Favourorg/Stellar-forge/commit/4e7abc445ef9bb859033a1154087f4e06c60d426))
- **ui:** add DropZone drag-and-drop component and replace file input in MetadataUploadForm ([fee9791](https://github.com/Favourorg/Stellar-forge/commit/fee979106b6aa2f6cabdae7a8d89e34187fb4516))
- **ui:** add network-aware Stellar Expert explorer links ([20dced8](https://github.com/Favourorg/Stellar-forge/commit/20dced85535f61c3700295b38486148e21fcee85)), closes [#621](https://github.com/Favourorg/Stellar-forge/issues/621)
- **ui:** confirmation modal before every state-changing transaction ([#490](https://github.com/Favourorg/Stellar-forge/issues/490)) ([88291e3](https://github.com/Favourorg/Stellar-forge/commit/88291e3a54fb6581068f0aa474301effc8d5839f))
- **ui:** implement MetadataForm with IPFS upload + Stellar linking ([#676](https://github.com/Favourorg/Stellar-forge/issues/676)) ([20f5327](https://github.com/Favourorg/Stellar-forge/commit/20f53270a24aafadba31984dde41b3b1f4605ad7))
- upgrade mechanism, ADRs, QR code sharing, onboarding tutorial ([7b59535](https://github.com/Favourorg/Stellar-forge/commit/7b5953553e50e0d011aefd8d581d346cd03eef0d)), closes [#1](https://github.com/Favourorg/Stellar-forge/issues/1) [#2](https://github.com/Favourorg/Stellar-forge/issues/2) [#3](https://github.com/Favourorg/Stellar-forge/issues/3) [#4](https://github.com/Favourorg/Stellar-forge/issues/4)
- **ux:** insufficient balance warning before transaction submission ([#496](https://github.com/Favourorg/Stellar-forge/issues/496)) ([0777d93](https://github.com/Favourorg/Stellar-forge/commit/0777d937bf16c0428cc0c9b8981bcf6322cfba66))
- wire setMetadata to StellarService in TokenDetail ([04de946](https://github.com/Favourorg/Stellar-forge/commit/04de946b9f1be0b11b385f12dd0138798cb79437))
- wire up mint and burn token UI to contract ([ca6b7b4](https://github.com/Favourorg/Stellar-forge/commit/ca6b7b41537ff00ac62d56316089355f62a6b188)), closes [#541](https://github.com/Favourorg/Stellar-forge/issues/541)

### Performance Improvements

- apply useMemo, useCallback, and React.memo for render optimizations ([8afb78a](https://github.com/Favourorg/Stellar-forge/commit/8afb78ab2911e0681f21866959e39a6fbf41e427))
- fetch creator token pages concurrently with capped concurrency ([#969](https://github.com/Favourorg/Stellar-forge/issues/969)) ([bfdc828](https://github.com/Favourorg/Stellar-forge/commit/bfdc8285861c5382f87933f48f45c85dfdc50c5d)), closes [#16](https://github.com/Favourorg/Stellar-forge/issues/16)
- **frontend:** implement route-level code splitting and lazy load stellar-sdk ([a9ed488](https://github.com/Favourorg/Stellar-forge/commit/a9ed488c4633a910765ae678de6f5cc63589a4e2))
