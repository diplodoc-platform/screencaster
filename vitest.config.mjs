import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/unit/**/*.test.ts', 'test/architecture/**/*.test.ts'],
        exclude: ['node_modules', 'build', 'test/browser/**'],
    },
});
