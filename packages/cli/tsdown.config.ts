import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['bin/flue.ts'],
	format: ['esm'],
	dts: false,
	clean: true,
	outDir: 'dist',
});
