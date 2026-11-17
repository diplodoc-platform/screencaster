import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/unit/**/*.test.ts', 'test/architecture/**/*.test.ts'],
        exclude: ['node_modules', 'build', 'test/browser/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts'],
        },
    },
});
