import { build } from 'esbuild';
await build({entryPoints:[new URL('./code.ts',import.meta.url).pathname],outfile:new URL('./code.js',import.meta.url).pathname,bundle:true,format:'iife',target:'es2020'});
