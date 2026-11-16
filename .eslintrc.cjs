module.exports = {
    root: true,
    extends: [
        require.resolve('@diplodoc/infra/eslint-config/node'),
        // Keep editor and CLI formatting rules consistent, regardless of npm_command.
        require.resolve('@gravity-ui/eslint-config/prettier'),
    ],
    parserOptions: {
        tsconfigRootDir: __dirname,
        project: true,
    },
    // The shared preset still names two formatting rules removed in typescript-eslint 8.
    rules: {
        '@typescript-eslint/member-delimiter-style': 'off',
        '@typescript-eslint/type-annotation-spacing': 'off',
    },
    overrides: [
        {files: ['test/**/*.ts'], parserOptions: {project: './tsconfig.test.json'}},
        {
            files: ['*.mjs'],
            parserOptions: {
                project: null,
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
    ],
};
