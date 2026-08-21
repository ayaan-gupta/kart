// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // server/.venv is a Python virtualenv. eslint was walking into it and reporting 37 errors
    // in vendored JavaScript shipped inside torch and sklearn, which drowned the three real
    // ones in this repository.
    ignores: ["dist/*", "server/.venv/**", "server/eval/.cache/**", "**/node_modules/**"],
  }
]);
