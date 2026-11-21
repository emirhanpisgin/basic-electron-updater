# Migration to signed updates

This document describes migration from the published `1.1.0` trust model (no
publisher authentication) to `2.0.0`, the first release with signed update
manifests and fail-closed security defaults.

## Breaking changes

1. `new Updater({ repo })` now throws `SecurityConfigError` because no pinned
   public key was supplied. Secure mode is the default.
2. `checkForUpdates()` verifies the signed manifest before emitting
   `update-available`. A missing/invalid/expired manifest is a
   `UpdateSecurityError`, not a silent "no update".
3. `downloadUpdate()` requires a verified manifest and writes into a private
   staging directory. It never falls back to unsigned bytes.
4. `applyUpdate()` re-verifies size/hash/path and rejects concurrent launches.
5. Electron is now a peer/dev dependency, not a runtime dependency of the package.
6. `security.*` configuration is new; see `docs/SIGNING.md`.

## Minimum consumer configuration

```ts
const updater = new Updater({
  repo: "owner/repo",
  security: {
    publicKeys: [
      { keyId: "release-2026-01", publicKey: "<base64 SPKI Ed25519 public key>" },
    ],
  },
});
```

Existing callers should also handle rejection from `checkForUpdates` and
`downloadUpdate`; cancellation still uses `AbortError`, timeouts use
`TimeoutError`, and verification failures use `UpdateSecurityError` with a
`code`.

## Release process changes

For every release, publish these assets in addition to the installer:

- `update-manifest.json` (exact bytes signed offline);
- `update-manifest.json.sig` (base64 detached Ed25519 signature);
- the installer named exactly by the signed manifest.

The manifest must bind the release tag version, appId/repo, channel, platform,
architecture, asset name/size/SHA-256, and a short expiry. See
`docs/SIGNING.md`. Do not publish a manifest that points at an unsigned or
different asset.

## Bootstrap and old clients

Clients already running an unsigned updater cannot gain verification
retroactively. The first transition must be delivered by a trusted manual/OS
installer (or an already trusted channel); only updates after that can require a
signed manifest. Plan this explicitly rather than claiming old clients are
protected.

## Legacy unsigned mode

For a temporary migration window only:

```ts
security: {
  allowUnsignedUpdates: true,
  requireManifestSignature: false,
  requireSha256: true, // or false only if you accept the historical risk
}
```

This logs a warning and restores the legacy asset-policy/download path. It is not
recommended for production and should be removed once signed manifests are
published. Never present this mode as signature verification.

## Key rotation and rollback

- Pin old and new keys during rotation; sign with the new `keyId` when the app
  fleet can verify it. See `docs/SIGNING.md`.
- Removing a compromised key requires an app release; there is no remote key
  revocation.
- Downgrades are rejected by default. The signed-manifest/running-version guard
  is rechecked in `downloadUpdate()` and again in `applyUpdate()`, and manifest
  expiry is rechecked at the final launch step. A deliberate recovery must be a
  manual, out-of-band install; do not add an unsigned downgrade shortcut.

## Desktop integration

The desktop app must supply its pinned key(s), handle `UpdateSecurityError`, and
provide an Authenticode verifier if it wants Windows publisher verification.
The library does not verify Authenticode by itself. Coordinate the desktop
dependency/lockfile update after the owner approves a new package version.

## Verification checklist

- `npm test`, `npm run lint`, `npm run build` pass.
- `npm pack --dry-run` contains only `dist`, `README.md`, `docs`,
  `SECURITY.md`, `SECURITY_AUDIT.md`, `LICENSE` and `package.json`.
- A signed manifest validates; missing/wrong signature, expired manifest,
  mismatched app/version/platform/arch/channel, tampered hash and unsafe name all
  reject with zero installer launches.
- A tampered staged installer is rejected before launch.
- `npm audit --omit=dev` has no high/critical advisories.
