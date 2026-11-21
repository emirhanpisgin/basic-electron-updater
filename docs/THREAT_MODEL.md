# Threat model

## Assets protected

- Users' machines and accounts, especially Windows desktops where an update
  installer runs with the user's privileges.
- The integrity of the installed application and its local data.
- The update signing trust anchor (the application-embedded Ed25519 public key).

## Attacker-controlled inputs

- GitHub release list, tags, release notes, asset names, sizes, digests and
  `browser_download_url` values.
- The bytes of `update-manifest.json` and its signature asset.
- HTTP redirects, DNS answers and response headers from download hosts.
- Asset filename strings before sanitization.
- Local files in the staging directory after download.

## Trust anchors

1. The Ed25519 public keys compiled into the consuming application. They are not
   fetched from GitHub and cannot be replaced by an update.
2. An optional Authenticode verifier supplied by the application. The library
   does not implement one.

## Threat actors

- **Release-channel attacker:** can modify releases/assets but not the app binary
  or signing key. This is the main threat the manifest signature addresses.
- **Signing-key thief:** can produce valid manifests. This is the principal
  residual risk; key custody and revocation are outside the library.
- **Network/redirect attacker:** can tamper with or redirect downloads. TLS,
  signature, hash, host allow-list and size/timeout checks apply.
- **Local same-user attacker:** can read/write the staging directory and race
  verification. Full protection is not claimed.
- **Malicious local admin/OS:** out of scope; can already replace the app or
  installer.

## Update flow and controls

1. **Discovery** — GitHub API returns release metadata. It is only a candidate;
   version must be valid and newer.
2. **Manifest authentication** — exact manifest bytes are verified with a pinned
   Ed25519 key; `keyId` selects only a pinned key. The manifest binds app,
   version, channel, platform, architecture, issue/expiry, asset name, size and
   SHA-256. `update-available` is emitted only after verification in secure mode.
3. **Download** — HTTPS only; no URL credentials; exact-host allow-list; reject
   private/loopback/link-local destinations and non-443 ports; validate each
   redirect; enforce maximum bytes and request/operation timeouts.
4. **Staging** — private `mkdtemp` directory; sanitized basename; exclusive file
   creation; cleanup on failure/abort; no remote filename path components.
5. **Integrity** — mandatory signed SHA-256 and size; hash/size rechecked before
   launch; wrong/truncated/oversized content is rejected.
6. **Execution** — only after manifest/hash/size checks and optional Authenticode
   verifier; `execFile` with an argument array; no metadata-supplied arguments;
   single-flight launch guard.

## Threats and dispositions

| Threat | Control | Residual |
|---|---|---|
| Malicious release asset | Signed manifest + pinned key | Compromised signing key |
| Manifest modification | Detached Ed25519 over exact bytes | Key theft |
| Missing/invalid hash | Mandatory SHA-256/size | None in secure mode |
| Path traversal | Safe basename + private staging | Local process race |
| SSRF/redirect abuse | Host allow-list, private-IP rejection, HTTPS | DNS rebinding |
| Oversized/hung download | Max bytes, request/operation timeouts | OS/network behavior |
| Downgrade/replay | semver strict newer + expiry + app/version binding; rechecked at download and apply | Deliberate old-manifest replay before expiry is constrained by release version binding and the running-version guard |
| Concurrent execution | In-flight guards | Repeated deliberate user action after success |
| Unsigned installer | Reject by default; explicit legacy warning | Authenticode is application-supplied |
| Key rotation | Multiple pinned keys keyed by `keyId` | Coordination of app release/revocation |

## Non-goals

- Protecting against a compromised signer, compromised CI secret, or malicious
  maintainer with legitimate signing ability.
- Verifying Windows certificate chains/publisher identity without an application
  verifier.
- Preventing a local administrator or the same user from modifying the app,
  staging directory or process.
- Guaranteeing DNS pinning against rebinding.
- Providing an unsigned fallback without an explicit legacy opt-in.
- Replacing OS code signing/notarization.

## Security invariants for tests

- No installer URL is fetched after manifest signature failure.
- No `downloaded` event or stored path after failed verification/abort.
- No launch after hash/size/Authenticode failure.
- No path separator or `..` reaches a local destination.
- No two downloads/launches overlap.
- Older/equal versions never become an update.
