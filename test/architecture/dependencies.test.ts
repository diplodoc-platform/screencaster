import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {expect, it} from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = path.join(root, 'src');
const files = ts.sys.readDirectory(sourceRoot, ['.ts']).filter((file) => !file.endsWith('.d.ts'));
const allowed: Record<string, readonly string[]> = {
    application: ['application', 'browser', 'media', 'instruction', 'agent', 'providers', 'shared'],
    server: [
        'server',
        'application',
        'browser',
        'media',
        'instruction',
        'agent',
        'transport',
        'shared',
    ],
    browser: ['browser', 'transport', 'shared'],
    media: ['media', 'shared'],
    instruction: ['instruction', 'shared'],
    providers: ['providers', 'media', 'shared'],
    transport: ['transport', 'shared'],
    agent: ['agent', 'shared'],
    shared: ['shared'],
};

const moduleName = (file: string) => path.relative(sourceRoot, file).split(path.sep)[0];

function imports(file: string) {
    const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );
    return source.statements.flatMap((node) => {
        if (
            (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
            !node.moduleSpecifier ||
            !ts.isStringLiteral(node.moduleSpecifier) ||
            !node.moduleSpecifier.text.startsWith('.')
        ) {
            return [];
        }
        const specifier = node.moduleSpecifier.text;
        const target = path.resolve(
            path.dirname(file),
            specifier.replace(/\.js(?:\?script)?$/, '.ts'),
        );
        const typeOnly = ts.isImportDeclaration(node)
            ? node.importClause?.isTypeOnly ||
              (node.importClause?.namedBindings &&
                  ts.isNamedImports(node.importClause.namedBindings) &&
                  node.importClause.namedBindings.elements.every((element) => element.isTypeOnly))
            : node.isTypeOnly;
        return [{target, typeOnly}];
    });
}

it('keeps source filenames in kebab-case and resolves local module imports', () => {
    for (const file of files) {
        expect(path.basename(file), file).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.ts$/);
        for (const {target} of imports(file)) {
            expect(fs.existsSync(target), `${file} imports missing ${target}`).toBe(true);
        }
    }
});

it('keeps runtime dependencies inside the documented module boundaries', () => {
    const violations: string[] = [];
    for (const file of files) {
        const owner = moduleName(file);
        if (!allowed[owner]) {
            continue;
        } // Package entry points compose the public API.
        for (const {target, typeOnly} of imports(file)) {
            if (!typeOnly && !allowed[owner].includes(moduleName(target))) {
                violations.push(`${path.relative(root, file)} -> ${path.relative(root, target)}`);
            }
        }
    }
    expect(violations).toEqual([]);
});

it('keeps runtime imports acyclic', () => {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    function visit(file: string, chain: string[]) {
        if (visiting.has(file)) {
            throw new Error(
                `Runtime import cycle: ${[...chain, file].map((item) => path.relative(root, item)).join(' -> ')}`,
            );
        }
        if (visited.has(file)) {
            return;
        }
        visiting.add(file);
        for (const dependency of imports(file)) {
            if (!dependency.typeOnly) {
                visit(dependency.target, [...chain, file]);
            }
        }
        visiting.delete(file);
        visited.add(file);
    }
    for (const file of files) {
        visit(file, []);
    }
});
