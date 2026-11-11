module.exports = {
    root: true,
    extends: require.resolve('@diplodoc/infra/eslint-config/node'),
    parserOptions: {
        tsconfigRootDir: __dirname,
        project: true,
    },
    overrides: [
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
