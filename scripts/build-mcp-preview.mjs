import {build} from 'esbuild';

await build({
    entryPoints: ['src/mcp-preview.tsx'],
    bundle: true, jsx: 'automatic',
    minify: true,
    define: {'process.env.NODE_ENV': '"production"'},
    outfile: 'dist/mcp-preview.js',
});

await build({
    entryPoints: ['scripts/mcp-domain.mjs'],
    platform: 'node',
    bundle: true,
    outfile: 'dist/mcp-domain.cjs',
});
