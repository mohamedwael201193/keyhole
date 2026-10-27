import next from "eslint-config-next";
const config = [
  ...next,
  // Mount-time reads from localStorage/sessionStorage/URL hash legitimately set state once in an effect.
  { rules: { "react-hooks/set-state-in-effect": "off" } },
  { ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
];
export default config;
