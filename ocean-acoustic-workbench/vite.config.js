import {defineConfig} from 'vite';
export default defineConfig({
  server:{port:5173,proxy:{'/api':'http://127.0.0.1:8765'}},
  build:{
    outDir:'dist',
    // Vendor code changes far less often than app code, so it gets its own
    // long-lived chunks. Markdown and math share dependencies (remark-math,
    // rehype-katex both touch unified/mdast), so they stay in one chunk to
    // avoid a circular dependency between chunks.
    chunkSizeWarningLimit:900,
    rollupOptions:{
      output:{
        manualChunks(id){
          if(!id.includes('node_modules'))return undefined;
          if(/[\\/](react|react-dom|scheduler)[\\/]/.test(id))return 'vendor-react';
          if(/[\\/](cytoscape|layout-base|cose-base)[\\/]/.test(id))return 'vendor-cytoscape';
          if(/[\\/](lucide-react)[\\/]/.test(id))return 'vendor-icons';
          if(/[\\/](katex|rehype-katex|remark-math|remark-.*|rehype-.*|react-markdown|unified|micromark.*|mdast.*|hast.*|unist.*|vfile.*|highlight\.js|lowlight|refractor)[\\/]/.test(id))return 'vendor-content';
          return 'vendor-misc';
        },
      },
    },
  },
});
