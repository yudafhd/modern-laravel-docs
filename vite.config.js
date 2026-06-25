import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
    plugins: [react()],
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
        lib: {
            entry: resolve(__dirname, 'resources/js/docs/main.tsx'),
            name: 'Larafeel',
            formats: ['iife'],
            fileName: () => 'larafeel.js',
        },
        outDir: 'resources/dist',
        rollupOptions: {
            output: {
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === 'style.css') return 'larafeel.css';
                    return assetInfo.name;
                },
            },
        },
    },
});
