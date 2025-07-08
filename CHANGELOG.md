# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2025-07-08

### Added
- Comprehensive testing infrastructure with Mocha and TypeScript
- ESLint configuration for code quality
- GitHub Actions CI/CD workflow for automated testing and publishing
- Enhanced development scripts (test, lint, dev, clean)
- Professional documentation with CHANGELOG.md
- .npmignore for better package publishing control
- Funding information in package.json

### Improved
- Better package structure and organization
- Enhanced development experience with watch mode
- Automated quality checks and testing
- Multi-node version testing (18, 20, 22)

### Fixed
- Package publishing configuration
- Development dependencies management

## [1.0.2] - 2025-07-08

### Added
- Cross-platform auto-update support for Electron Forge apps
- GitHub Releases integration
- Event-based API with TypeScript support
- Secure HTTPS-only downloads with SHA256 validation
- Optional GPG signature verification
- Code signing validation for Windows and macOS
- Support for prerelease and channel-based updates
- Debug logging capabilities

### Features
- Windows: Squirrel.Windows support with automatic restart
- macOS: ZIP and DMG support with code signing verification
- Linux: AppImage, DEB, and RPM support
- Manual and automatic update checking
- Download progress tracking
- Background downloads
- Configurable update channels

### Security
- HTTPS-only downloads
- SHA256 checksum verification
- Optional GPG signature validation
- Code signing verification on supported platforms

## [Unreleased]

### Added
- Initial release of basic-electron-updater

---

## Release Notes

### [1.0.2]
- Stable release with full cross-platform support
- Complete TypeScript definitions
- Comprehensive documentation
- Production-ready security features
