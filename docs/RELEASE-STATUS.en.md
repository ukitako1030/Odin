[日本語](RELEASE-STATUS.md) | **English**

# Release status

This repository is a **private release-preparation build**, not a publicly released distribution.

- The export includes an explicit list of application files, documentation, and selected assets. Personal records, actual environment credentials, and internal operations notes are excluded.
- Code and image licensing and redistribution terms are not finalized. No reuse license has been granted. Earlier commits contain superseded artwork; asset review and release-history preparation remain necessary before publication. See [the asset review (Japanese)](ASSET-REVIEW.md).
- Configure Google Drive, your AI client, and hosting with your own accounts and credentials. The author's connections are not shared with this package.
- The interface supports Japanese and English. User-created content is not automatically translated. Choose English in Settings or on the login screen; the default is Japanese.
- The README, setup guide, AI connection guide, plugin guide, and workflow illustration have English versions. Existing screenshots show the Japanese interface and fictional records.

## Verification scope

The Japanese [release log](RELEASE-STATUS.md) records dated checks. Generated plugin files and archives are tested locally; this does not verify installation or OAuth sign-in in your account. After connecting your own services, check status, save a test record, and read it back.

Browser checks and screenshots from earlier versions do not verify the current English layout. Any unverified UI behavior is recorded in the release log.

On 2026-09-27, the synchronized distribution passed all 95 unit tests, type checking, and a production webpack build. All seven export-guard tests passed. Relative documentation links, images, heading anchors, and generated English plugin packages were checked. Current desktop/mobile browser checks and E2E were not run because a saved browser permission setting blocks them. Actual account authorization and installation remain unverified. Repository visibility remains PRIVATE.
