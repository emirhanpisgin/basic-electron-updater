# Security policy

`basic-electron-updater` downloads and launches installers, so an update mistake
is remote code execution. This document describes the guarantees the package
actually implements, and the ones it does not.

**Published `1.1.0` did not include the hardened controls described here.**
Version `2.0.0` is the first release with signed update manifests and the
fail-closed security defaults described below.

## Reported guarantees

- Updates are authenticated by a detached Ed25519 signature over an exact
  update-manifest byte sequence.
- The signature is verified against one or more application-pinned public keys.
  The release server cannot add a key. A manifest `keyId` is only a lookup hint
  and must match the key that actually verified the bytes.
- Signed manifests bind `appId`, version, channel, platform, architecture,
  `publishedAt`, `expiresAt`, asset name, size and SHA-256.
- The installer SHA-256 and size are mandatory and are checked during/after
  download and again immediately before launch.
- The signed manifest version must be strictly newer than the running app; the
  guard is re-checked in `downloadUpdate()` and again in `applyUpdate()`. Manifest
  expiry is also re-checked at the final launch step.
- Downloads use HTTPS only, reject credentials in URLs, reject HTTP and
  private/loopback/link-local destinations, and validate every redirect against
  the configured host allow-list.
- Downloads are bounded by an explicit maximum size and request/operation
  timeouts.
- Installers are written to a private per-attempt staging directory with a
  generated/sanitized filename and exclusive creation.
- Installer execution uses argument arrays; remote metadata never supplies
  arguments or the executable path.
- Concurrent downloads and concurrent installer launches are rejected.
- Unsigned updates are rejected by default. Legacy unsigned behavior requires
  `security.allowUnsignedUpdates: true` and logs a warning.

## Not guaranteed

- **No built-in Windows Authenticode verification.** The package provides an
  optional `authenticodeVerifier` callback and `expectedWindowsPublisher` value;
  the application must implement certificate-chain/status and publisher-identity
  verification. Without that callback, Authenticode is not checked.
- **A compromised signing key defeats the manifest.** Key custody, offline
  signing, rotation and revocation are release-process responsibilities.
- **No DNS-rebinding proof.** Host allow-listing and literal private-IP rejection
  are implemented; DNS resolution can still change between validation and
  connection. The default allow-list contains GitHub asset hosts.
- **No complete TOCTOU guarantee.** The verified artifact is re-hashed and path-
  checked immediately before launch, but another process with write access to
  the staging directory could still replace it between the final check and
  `execFile`.
- **No protection against a compromised OS, administrator, or same-user
  attacker** with access to the staging directory and Electron process.
- **Legacy unsigned mode is not a security guarantee.** It is an explicit
  migration escape hatch and preserves the historical trust model.
- **No publisher identity from SHA-256 or HTTPS alone.** GitHub `digest` values
  are unauthenticated metadata; the signed manifest hash is authoritative.

## Trust model

GitHub Releases and the GitHub API are treated as untrusted distribution
channels. The trust anchors are the Ed25519 public keys embedded by the
application and, only when configured, the application's Authenticode verifier.
No key is fetched from the release server. See
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) and
[`docs/SIGNING.md`](docs/SIGNING.md).

## Secure mode

Secure mode is the default. At minimum:

```ts
const updater = new Updater({
    repo: "owner/repo",
    security: {
        publicKeys: [
            {
                keyId: "release-2026-01",
                publicKey: "<base64 SPKI Ed25519 public key>",
            },
        ],
        // manifestAssetName / manifestSignatureAssetName may be overridden
    },
});
```

Each release must contain the signed `update-manifest.json` and its detached
`update-manifest.json.sig` alongside the installer. `checkForUpdates()` verifies
the manifest before emitting `update-available`; `downloadUpdate()` re-verifies
the installer hash/size before emitting `downloaded`; `applyUpdate()` re-verifies
again before launch.

## Legacy mode

`allowUnsignedUpdates: true` plus `requireManifestSignature: false` is the only
way to retain unsigned downloads. It must be paired with an explicit
`requireSha256` decision; disabling signature checks silently is a configuration
error. Legacy mode is intended for migration only and should be removed once
signed releases are published.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Report it privately to
the package maintainers with:

- affected version and platform;
- a minimal reproduction or test case;
- the trust boundary and expected impact;
- whether a signing key or release credential may be involved.

Do not include production private keys, update tokens or user data in a report.
