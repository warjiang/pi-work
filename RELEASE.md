# macOS Release

Pi Work is distributed directly as a signed and notarized DMG/ZIP. It is not
submitted to the Mac App Store.

## One-time Apple setup

1. In the Apple Developer portal, create a **Developer ID Application**
   certificate.
2. Install it on a Mac, then export the certificate and private key from
   Keychain Access as a password-protected `.p12`.
3. In App Store Connect, create an API key with the Developer role and download
   the `.p8` file. Record its Key ID and Issuer ID.
4. Add these GitHub Actions secrets:

   - `APPLE_CODESIGN_CERT_P12_BASE64`: base64-encoded `.p12`
   - `APPLE_CODESIGN_CERT_PASSWORD`: password used when exporting the `.p12`
   - `APPLE_API_KEY_P8_BASE64`: base64-encoded `.p8`
   - `APPLE_API_KEY_ID`: App Store Connect API Key ID
   - `APPLE_API_ISSUER_ID`: App Store Connect Issuer ID
   - `APPLE_TEAM_ID`: 10-character Apple Developer Team ID

Encode files without line wrapping:

```bash
base64 < DeveloperIDApplication.p12 | tr -d '\n'
base64 < AuthKey_KEYID.p8 | tr -d '\n'
```

## CI release

Before releasing:

1. Update `apps/desktop/package.json` to the intended version.
2. Run `pnpm check`.
3. Commit the version change.
4. Either push a matching tag, for example `v0.1.0`, or manually run the
   **Release** workflow in GitHub Actions with `dry_run` disabled.

The workflow builds the app, signs every executable with Developer ID, submits
it to Apple's notary service, staples the ticket, verifies Gatekeeper
acceptance, and creates a GitHub Release containing the DMG and ZIP.
The release build has forced code signing enabled, so missing or invalid
certificate secrets fail the workflow instead of producing an unsigned release.
Release packaging, signing, notarization, and artifact publication run only in
GitHub Actions; no local release command is provided.

For a tag-triggered release, keep the tag and package version identical.

## CI dry-run

Open a pull request containing release-related changes, or manually run the
**Release** workflow with the default `dry_run` option enabled. This runs the
complete test and macOS packaging path on a GitHub-hosted macOS runner,
validates the DMG, ZIP, app metadata, and bundled Pi runtime, but does not read
release secrets, sign, notarize, upload artifacts, create tags, or publish a
GitHub Release.
