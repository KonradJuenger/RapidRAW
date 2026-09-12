import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Instrument only this benchmark build; application source is left unchanged.
export default defineConfig({
  plugins: [
    {
      name: 'warper-benchmark-instrumentation',
      enforce: 'pre',
      transform(source, id) {
        let s = source.replaceAll('\r\n', '\n');
        let label, flag, end;
        if (id.endsWith('/WarperDensityCanvas.tsx')) {
          label = "slice ? 'sliceDots' : 'wheelDots'";
          flag = 'dots';
          end = '  }, [points, limit, angle, spokes, slice, spoke]);';
        } else if (id.endsWith('/LightnessSlice.tsx')) {
          label = "'sliceBackground'";
          flag = 'background';
          end = '  }, [backgroundKey]);';
        }
        if (end) {
          if (!s.includes(end)) throw Error('Benchmark instrumentation no longer matches ' + id);
          s = s.replace(
            '  useEffect(() => {',
            `  useEffect(() => {
          if (globalThis.warperBenchFlags?.${flag} === false) return;
          ${flag === 'dots' ? `if (globalThis.warperBenchFlags?.[slice ? 'sliceDots' : 'wheelDots'] === false) return;` : ''}
          const benchStart = performance.now(); try {`,
          );
          s = s.replace(
            end,
            `  } finally { globalThis.warperBenchRecord?.(${label}, performance.now() - benchStart); }
${end}`,
          );
          return s;
        }
      },
    },
    tailwindcss(),
    react(),
  ],
  build: { outDir: 'bench/out/warper-build', rollupOptions: { input: 'scripts/benchmarks/warper.html' } },
});
