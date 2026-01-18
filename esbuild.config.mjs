import esbuild from "esbuild";
import { readFileSync } from "fs";

const banner = readFileSync("banner.txt", "utf8");

const isWatch = process.argv.includes("--watch");

const ctxPromise = esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  sourcemap: true,
  target: "es2020",
  outfile: "dist/main.js",
  format: "cjs",
  banner: {
    js: banner,
  },
  external: ["obsidian"],
});

if (isWatch) {
  ctxPromise.then((ctx) =>
    ctx.watch().then(() => {
      console.log("Watching for changes...");
    }),
  );
} else {
  ctxPromise.then((ctx) => ctx.rebuild().then(() => ctx.dispose()));
}
