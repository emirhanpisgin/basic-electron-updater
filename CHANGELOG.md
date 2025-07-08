# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.6] - 2025-07-08

### Fixed
- **Code Quality**: Fixed all ESLint errors and warnings
- **Type Safety**: Improved error handling with proper Error types instead of `any`
- **Logger Interface**: Enhanced Logger interface with better type definitions
- **Platform Handlers**: Fixed error callback types in platform-specific update handlers

### Technical Details
- Removed unused imports (UpdateInfo, fs)
- Fixed empty catch blocks with proper comments
- Improved error handling with `unknown` type and proper Error conversion
- Added missing return type annotations
- Enhanced type safety across all modules

## [1.0.5] - 2025-07-08

### Fixed
- **Windows Installer Launch**: Removed problematic `--update` flag from Windows installer execution
- **Compatibility**: Fixed compatibility with Squirrel.Windows and NSIS installers
- **Auto-Update Flow**: Windows installers now launch correctly without arguments

### Technical Details
- Simplified `applyWindowsUpdate()` to launch installers without any command-line arguments
- Most Windows installers handle updates automatically when launched
- Better compatibility across different Windows installer types

## [1.0.4] - 2025-07-08

### Fixed
- **Critical Download Issue**: Fixed 302 redirect handling in downloader
- **GitHub Releases**: Now properly follows redirects from GitHub release assets
- **Error Handling**: Better error messages for download failures
- **Progress Tracking**: Fixed progress calculation during downloads

### Technical Details
- Enhanced `Downloader.downloadAsset()` to handle HTTP redirects (301, 302, 307, 308)
- Added redirect loop protection (max 5 redirects)
- Improved progress calculation accuracy
- Better cleanup on download errors

## [1.0.4] - 2025-07-08

### Fixed
- 🚨 **CRITICAL**: Fixed HTTP redirect handling in Downloader (resolves 302 errors)
- 🚨 **CRITICAL**: Added missing `checking-for-update` event emission
- 🚨 **CRITICAL**: Improved GitHub API error handling with detailed error messages
- ⚠️ **IMPORTANT**: Enhanced asset filtering logic for better platform detection
- ⚠️ **IMPORTANT**: Added version parsing safety checks
- ⚠️ **IMPORTANT**: Fixed GPG signature download redirect handling
- ⚠️ **IMPORTANT**: Improved platform-specific update handlers with proper app quitting
- ⚠️ **IMPORTANT**: Enhanced Linux installer handling for different package types

### Enhanced
- Better error messages for network issues and API failures
- More robust platform asset detection (Windows, macOS, Linux)
- Improved installer execution for different platforms
- Added User-Agent header for GitHub API requests

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
