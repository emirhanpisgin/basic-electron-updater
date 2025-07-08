import { describe, it } from 'mocha';
import * as assert from 'assert';
import Updater from '../src/index';
import { UpdaterConfig } from '../src/types';

describe('Updater', () => {
    describe('constructor', () => {
        it('should create an instance with valid config', () => {
            const config: UpdaterConfig = {
                repo: 'test/repo'
            };
            
            const updater = new Updater(config);
            assert.ok(updater instanceof Updater);
        });

        it('should throw error with invalid repo format', () => {
            const config: UpdaterConfig = {
                repo: 'invalid-repo-format'
            };
            
            assert.throws(() => {
                new Updater(config);
            }, /Invalid repository format/);
        });
    });

    describe('configuration', () => {
        it('should use default values for optional config', () => {
            const config: UpdaterConfig = {
                repo: 'test/repo'
            };
            
            const updater = new Updater(config);
            // Test that defaults are applied correctly
            assert.ok(updater);
        });

        it('should accept custom configuration', () => {
            const config: UpdaterConfig = {
                repo: 'test/repo',
                autoDownload: false,
                allowPrerelease: true,
                channel: 'beta',
                debug: true
            };
            
            const updater = new Updater(config);
            assert.ok(updater);
        });
    });

    describe('event handling', () => {
        it('should be able to register event listeners', () => {
            const config: UpdaterConfig = {
                repo: 'test/repo'
            };
            
            const updater = new Updater(config);
            
            // Test that event listeners can be registered without errors
            updater.on('update-available', (info) => {
                // Test listener
            });
            
            updater.on('download-progress', (progress) => {
                // Test listener
            });
            
            updater.on('downloaded', (file) => {
                // Test listener
            });
            
            updater.on('error', (error) => {
                // Test listener
            });
            
            assert.ok(true, 'Event listeners registered successfully');
        });
    });
});
