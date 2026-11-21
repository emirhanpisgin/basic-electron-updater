# Signing update manifests

This package authenticates an update by a detached Ed25519 signature over the
exact bytes of `update-manifest.json`. The signature asset is
`update-manifest.json.sig` by default. Both names are configurable.

The private key must never be committed, packaged, placed in a release asset or
embedded in the app. Only the public key is compiled into the application.

## Manifest schema (schemaVersion 1)

Exactly these top-level fields are accepted; unknown fields are rejected:

```json
{
  "schemaVersion": 1,
  "keyId": "release-2026-01",
  "appId": "owner/repo",
  "version": "1.2.0",
  "platform": "win32",
  "architecture": "x64",
  "channel": "latest",
  "publishedAt": "2026-11-21T00:00:00.000Z",
  "expiresAt": "2026-12-21T00:00:00.000Z",
  "assets": [
    {
      "name": "Melodify-1.2.0-win32-x64.exe",
      "size": 123456789,
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ]
}
```

- `schemaVersion` must be `1`.
- `keyId` must match one of the application-pinned keys.
- `appId` must equal `security.appId` (defaults to the GitHub repo string).
- `version` must be a valid semantic version equal to the release tag version.
- `platform`/`architecture` must match the running platform/architecture.
- `channel` must match the configured channel.
- `publishedAt`/`expiresAt` are ISO-8601 UTC timestamps. Expired or
  future-published manifests are rejected; five minutes of clock skew is allowed
  for `publishedAt`.
- `assets` must contain exactly one object; only `name`, `size`, `sha256` are
  accepted. The name must be a safe basename with a supported installer extension.
  The URL is resolved from the exact-name GitHub release asset and is not trusted
  for integrity.
- `sha256` is mandatory and is verified after download and again before launch.
- The manifest signature covers the exact UTF-8 bytes. Do not re-serialize or
  reformat the file after signing.

The signature asset is the base64 encoding of the raw 64-byte Ed25519 signature.
No algorithm field is trusted; only Ed25519 keys are accepted.

## Generate a test key (never use this as a production key)

```powershell
node -e "const c=require('crypto'); const {publicKey}=c.generateKeyPairSync('ed25519'); console.log(publicKey.export({format:'der',type:'spki'}).toString('base64'));"
```

This example only prints the public key. Generate and export the private key in a
controlled offline environment and store it in a release secret/HSM; never print it
in a terminal log or commit it.

## Sign a manifest

```js
// sign-manifest.mjs — example only; keep the private key outside the repo.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const manifestBytes = readFileSync(process.argv[2]);
const privateKey = createPrivateKey({
  key: Buffer.from(process.env.UPDATE_SIGNING_KEY, "base64"),
  format: "der",
  type: "pkcs8",
});
writeFileSync(
  process.argv[3],
  sign(null, manifestBytes, privateKey).toString("base64")
);
```

The signing job must upload the manifest and `.sig` as release assets. It must not
write the private key to logs or artifacts.

## Consumer configuration

```ts
const updater = new Updater({
  repo: "owner/repo",
  security: {
    publicKeys: [
      { keyId: "release-2026-01", publicKey: "<base64 SPKI public key>" },
    ],
    // manifestAssetName: "update-manifest.json",
    // manifestSignatureAssetName: "update-manifest.json.sig",
    // appId: "owner/repo",
    // allowedDownloadHosts: ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"],
    // maxDownloadBytes: 536870912,
  },
});
```

## Rotation and revocation

- Ship the next public key in an app release before signing releases with the new
  key.
- Keep the old and new keys pinned during the overlap. The signed manifest's
  `keyId` selects the matching pinned key.
- A revoked key requires an app release that removes the key; old apps continue to
  trust it until updated. There is no remote key revocation.
- Keep manifests short-lived and publish a new one per release. Expiry limits
  replay of an old signed manifest.

## Verification failure behavior

`checkForUpdates()` rejects with `UpdateSecurityError` for manifest/signature
failures; no `update-available` is emitted. `downloadUpdate()` rejects and removes
staging data; no `downloaded` is emitted. `applyUpdate()` re-verifies and refuses
to launch. The legacy unsigned path is available only with
`allowUnsignedUpdates: true` and a warning; it is not a signing mechanism.
