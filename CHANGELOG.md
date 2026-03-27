# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Keep a Changelog structure for tracking release history.

## [0.1.0] - 2026-03-27

### Added
- Initial public release of Popup Lookup add-on.
- Automated GitHub Release workflow with artifact publishing.

### Changed
- Build now reads version directly from `manifest.json`.
- Build now outputs only `.ankiaddon` artifact.

### Removed
- Standalone `version.json` file.
- `scripts/bump_version.py` script.

[Unreleased]: https://github.com/OWNER/REPO/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/REPO/releases/tag/v0.1.0
