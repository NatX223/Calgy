// Bundles src/ plus the workspace packages (@calgy/shared, @calgy/engine ship as TypeScript source)
// into dist/index.js. npm dependencies stay external and come from node_modules at runtime.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  plugins: [
    {
      name: "external-npm",
      setup(b) {
        // Bare imports are external unless they're ours.
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith("@calgy/") ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});
