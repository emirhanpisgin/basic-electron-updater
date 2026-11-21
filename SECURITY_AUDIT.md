# Security audit — basic-electron-updater

Audit date: 2026-11-21
Baseline: `d6a519d` (`v1.1.0` tag points to `fb1ab31`; `src/` unchanged after the tag)
Audited package: published `basic-electron-updater@1.1.0`
Hardened release: `basic-electron-updater@2.0.0` (built from this audit's working tree)

This is a source and bounded local audit. It does not claim a live exploit against
any release, user installation or GitHub account. The effective exposure of the
pre-hardening package is remote code execution by anyone able to modify the
release channel, because the installer was never authenticated.

## Trust boundaries

1. GitHub API/release metadata and asset bytes — untrusted.
2. Redirect destinations and DNS resolution — untrusted.
3. Downloaded filename/path — untrusted.
4. Installer bytes after verification — locally mutable until launch.
5. Release signing key — external trust anchor, not in the package.
6. Windows Authenticode certificate — optional, application-supplied trust anchor.

## Findings

Baseline `npm audit`: 17 advisories (14 high, 2 moderate, 1 low); `npm audit
--omit=dev`: 2 high (`electron`, `extract-zip`). After moving Electron to
peer/dev, `npm audit --omit=dev` reports 0. Dev-tool advisories remain in the full
audit and are not a runtime guarantee either way.

### C1 — High (critical impact) — No publisher-authenticated update; release metadata could execute arbitrary code

**Baseline evidence:** `src/Updater.ts:123-140` (metadata accepted after semver
comparison), `src/Updater.ts:200-266` (asset selected and downloaded), `src/Updater.ts:307-331`
(launch); `src/github/GitHubProvider.ts:123-133`; `src/download/Downloader.ts:393-398`.
There was no signed manifest, pinned key, or publisher identity check. SHA-256/GPG
fields were optional and normally absent.

**Attack:** anyone with repository release permission (or a compromised token,
collaborator account, or release-publishing path) uploads a new installer; every
client downloads and executes it. HTTPS and GitHub hosting authenticate the
connection, not the release publisher.

**Existing controls:** HTTPS; optional hash/GPG if metadata supplied it; GitHub
account security; desktop-side post-download path/type checks (outside this
package).

**Remediation:** signed manifest + pinned Ed25519 keys in secure mode; mandatory
size/hash; verification before `update-available`, `downloaded`, and launch. Legacy
unsigned mode is explicit and warns.
**Status:** mitigated for secure mode; legacy mode remains intentionally insecure.
**Tests:** `test/manifest.test.ts` (signature/claims), `test/secure-update.test.ts`
(missing/wrong signature, wrong key, tampered hash, no launch).

### H1 — High — SHA-256 verification was normally inactive and could not establish publisher identity

**Baseline evidence:** `src/github/GitHubProvider.ts:127-132` mapped
`a.sha256`/`a.gpgSignatureUrl`, fields GitHub does not provide; the actual field is
nullable `digest` (`sha256:<hex>`). `src/Updater.ts:221` passed the resulting
`undefined`; `src/download/Downloader.ts:393` skipped hashing. A GitHub digest is
unauthenticated release metadata even when present.

**Attack:** corrupt or swapped bytes pass the default path; a malicious release
publisher does not need to defeat any hash.

**Remediation:** provider maps `digest` and `size`; secure mode requires the
signed manifest's SHA-256/size and verifies both after download and again before
launch; legacy mode defaults to requiring a digest and can only omit it with an
explicit legacy configuration.
**Status:** fixed for secure mode; legacy remains opt-in.
**Tests:** `test/github-provider.test.ts` digest mapping; `test/manifest.test.ts`
missing/malformed hash; `test/secure-update.test.ts` hash mismatch/cleanup.

### H2 — High — Remote asset name could escape the temp directory

**Baseline evidence:** `src/Updater.ts:208-219` used `path.join(os.tmpdir(), asset.name)`;
`selectReleaseAsset` checked extensions but not path separators. Root confirmed
`Melodify-x64/../../evil.exe` resolved outside the temp directory. Whether GitHub
permits such an asset name was not validated; the package must not depend on it.

**Attack:** a malicious/compromised release asset name writes outside the update
staging directory, potentially overwriting a user-writable file before any hash
or execution decision.

**Remediation:** shared `assertSafeAssetName` rejects separators, `.`/`..`,
control characters, trailing dots/spaces and non-basenames; `selectReleaseAsset`
rejects unsafe names; secure manifests validate names; Updater uses a private
`mkdtemp` staging directory and a generated/sanitized basename with `wx`.
**Status:** fixed.
**Tests:** `test/asset-selection.test.ts` (unsafe name), `test/manifest.test.ts`
(unsafe manifest name), `test/secure-update.test.ts` (unsafe manifest asset).

### H3 — High/Medium — Download pipeline lacked SSRF, size and timeout controls

**Baseline evidence:** `src/download/Downloader.ts:195-247` validated HTTPS and
redirect protocol only; no host allow-list, private-IP rejection, embedded-
credential rejection, maximum size, or default timeout. Redirects could target
arbitrary hosts.

**Attack:** a release metadata/URL compromise could make the updater fetch
internal/loopback services (SSRF), consume unbounded disk/bandwidth, or hold the
process indefinitely. This compounds C1 but is independently real.

**Remediation:** `src/download/urlPolicy.ts` rejects credentials, non-HTTPS,
nonstandard ports, private/loopback/link-local hosts, and hosts outside the
configured allow-list, on every redirect. `DownloadPolicy` enforces `maxBytes`
and request/response timeouts; secure mode uses a GitHub asset allow-list,
512 MiB default installer cap and 30 s request timeout. DNS rebinding remains a
documented residual risk.
**Status:** mitigated; DNS rebinding is not fully solved.
**Tests:** `test/download-security.test.ts` (credentials, HTTP, private IPs,
redirect host/private target, declared/streaming size, timeout).

### H4 — High — Windows Authenticode/publisher identity was not checked

**Baseline evidence:** `src/platform/windows.ts:12` runs `execFile(installerPath, [])`
with no Authenticode or publisher check; no expected publisher configuration.

**Attack:** a signed-manifest failure is the primary barrier; if the signing key or
release process is compromised, an unsigned or wrong-publisher installer would
still run. Authenticode is an independent defense.

**Remediation:** optional `security.authenticodeVerifier` and
`expectedWindowsPublisher`; when configured, failure blocks launch. The library
does **not** ship a Windows certificate-chain/status implementation; this is an
explicit limitation, not a claim of Authenticode support.
**Status:** integration hook + documented limitation; built-in verification
remains unresolved.
**Tests:** `test/secure-update.test.ts` verifier failure prevents launch.

### M1 — Medium — TOCTOU between verification and installer launch

**Baseline evidence:** `src/Updater.ts:307-331` launched the stored path without a
final hash/size check; the path was in shared temp.

**Remediation:** secure artifacts live in a private staging directory; size/hash
and path containment are re-checked immediately before launch; concurrent launches
are rejected. A same-user process can still race the final check and `execFile`;
this is documented, not claimed solved.
**Status:** reduced, not eliminated.

### M2 — Medium — Concurrent download/installer execution

**Baseline evidence:** no in-flight guard around `downloadUpdate`/`applyUpdate`;
repeated calls could start overlapping downloads or launches.

**Remediation:** `downloadInProgress` and `applyInProgress` reject with
`UpdateSecurityError` code `CONCURRENT_UPDATE`; secure state is consumed after a
successful launch.
**Status:** fixed.
**Tests:** `test/secure-update.test.ts` concurrent download/apply.

### M3 — Medium — `electron` was a production dependency with vulnerable transitive tooling

**Baseline:** `package.json` listed `electron@^37.2.0` under `dependencies`;
`npm audit --omit=dev` reported 2 high advisories (`electron`, `extract-zip`).
Electron apps supply Electron themselves; bundling it as a runtime dependency also
inflates the consumer install and pulls audit noise.

**Remediation:** moved Electron to `devDependencies` plus peer dependency
`electron >=27`; production dependency is now only `semver`.
`npm audit --omit=dev` reports 0 advisories in the working tree. Full dev audit
still reports dev-tool advisories; this is not treated as proof of runtime safety.
**Status:** fixed for the published production dependency graph.

### M4 — Medium — Release workflow supply-chain gaps

**Baseline:** `publish.yml` uses `actions/checkout@v6` and
`actions/setup-node@v6` by tag, not commit SHA, and no workflow runs `npm audit`.
Trusted publishing/provenance is present.

**Remediation:** CI and publish workflows now run
`npm audit --omit=dev --audit-level=high`; package contents remain allow-listed.
Action SHA pinning is not changed in this pass (requires maintainer-managed SHA
updates).
**Status:** audit added; action pinning residual.

### L1 — Low — GPG verification trusted the local keyring and was unreachable from GitHub metadata

`src/download/validators/gpg.ts:13-17` ran `gpg --verify` without a publisher key
pin. The provider no longer maps a non-existent GPG URL. The GPG path is retained
only for legacy metadata; it is not an authenticity guarantee. Secure mode ignores
GPG. Documented in `README.md`/`SECURITY.md`.

### L2 — Low — Release selection used API order, not maximum semver

`GitHubProvider` used `filtered[0]`. It now sorts valid releases by descending
semantic version and keeps invalid versions after valid ones; `checkForUpdates`
still rejects non-semver and non-newer releases. Tested in
`test/github-provider.test.ts` and version tests.

### L3 — Low — Downgrade policy was implicit and untested

`semver.valid` + `semver.gt` existed, but no explicit test or documented rollback.
Secure manifests bind the release version and require exact equality; equal/older
releases produce `update-not-available`; no `allowDowngrade` path is added. The
running-version guard is re-checked before download and before apply, including a
verified-manifest version/expiry recheck at the final launch step, so a caller
cannot use a stale `lastUpdateInfo` to install an older signed release. Recovery
requires a deliberate manual install, documented in `docs/MIGRATION.md`. Tested in
`test/secure-update.test.ts` and `test/updater-asset-policy.test.ts`.

### I1 — Informational — Documentation overstated historical security

README/docs now distinguish HTTPS/hash checks from publisher authenticity and
state that code signing/publisher verification are not implemented. Historical
changelog entries are qualified; see `CHANGELOG.md`.

## Published artifact verification

At audit start, the published tarball was downloaded with `npm pack` to a temp
directory and compared with a fresh `tsc` build from `d6a519d`:

- `src/` diff `v1.1.0..HEAD` was empty.
- 30/30 `dist` files matched by SHA-256.
- Published shasum `be7146125ff91162e1470892eb5630eb434a96f3`; 34 files, no source,
  tests, keys or `.env`.
- No drift was found in the baseline artifact. The hardened tree is released as
  `2.0.0`; the release workflow rebuilds it from source and publishes with
  provenance, so verify the 2.0.0 tarball against that attestation.

## Residual risks

- Compromised signing key or release process (the primary remaining trust risk).
- No built-in Windows Authenticode chain/publisher verification.
- DNS rebinding between allow-list validation and connection.
- Last-moment TOCTOU by a same-user/local process.
- Legacy unsigned mode remains available for migration and is not secure.
- Action SHA pinning and full dev-dependency advisories remain release-process
  work.
