# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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

## v0.3.0 (2026-03-27)

### Feat

- Enhance loading dots styling and animation for improved visibility
- Add loading dots component and integrate into loading states
- Change default source language to 'auto' and update related settings
- Update popover shortcut from 'Alt+1' to 'Shift' and adjust related settings
- Implement audio stop functionality and manage active HTML audio elements
- Add French language support across various components

## v0.2.0 (2026-03-27)

### Feat

- Add Commitizen configuration and pre-push hook for versioning and changelog management
- Enhance GitHub release workflow and add changelog for version tracking
- Implement install ping marker reading and enhance installation tracking logic
- Implement install ping functionality to track addon installations
- Refactor settings modal layout and improve radio button handling for shortcut options
- Add debug panel visibility toggle and audio playback icon to UI
- Enhance settings management with new boolean coercion and config file handling
- Add audio playback functionality and language normalization

### Fix

- Align text to the left for translation components in popup CSS
- Update asset version and improve settings modal behavior for deck browser
