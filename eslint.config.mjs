import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored MediaPipe WASM loader, not our code.
    "public/mediapipe/**",
    // Python service and its virtualenv.
    "service/**",
    // Bundled test output.
    ".test-build/**",
  ]),
]);

export default eslintConfig;
