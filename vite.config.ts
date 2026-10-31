import {defineConfig} from 'vite';

export default defineConfig({
    server: {
        watch: {
            // Rust is watched by Tauri. Vite must not watch locked Windows binaries.
            ignored: ['**/src-tauri/**', '**/.pnpm-store/**', '**/frontend-build.log'],
        },
    },
});
