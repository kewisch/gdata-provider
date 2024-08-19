"use strict";

module.exports = {
  "env": {
    es2022: true,
    webextensions: true
  },
  "globals": {
    messenger: true
  },
  "root": true,
  "plugins": ["mozilla"],
  "extends": ["plugin:mozilla/recommended"],

  "rules": {
    // experiment files are not ES modules, so we can't use static import
    "mozilla/use-static-import": "off",

    // We are still experimenting, console messages are ok for now
    "no-console": "off",

    // Some other rules that don't seem to be in the recommended set
    "no-trailing-spaces": "error",
    "eol-last": "error",
    "quote-props": ["error", "consistent-as-needed", { keywords: true }],
    "quotes": ["error", "double", { avoidEscape: true }],
    "padded-blocks": ["error", "never"],
    "indent": [2, 2, { SwitchCase: 1 }],

    // Rules from https://searchfox.org/comm-central/source/.eslintrc.js#70
    "complexity": ["error", 80],
    "func-names": ["error", "never"],
    "mozilla/prefer-boolean-length-check": "off",
    // Enforce using `let` only when variables are reassigned.
    "prefer-const": ["error", { destructuring: "all" }],
    "mozilla/reject-chromeutils-import": "error",
  },

  "overrides": [
    {
      files: [".eslintrc.js"],
      env: {
        node: true,
        browser: false,
      },
    },
    {
      files: ["*/parent/*.js", "*/child/*.js"],
      globals: {
        global: true,
        Services: true,
      },
      rules: {
        "mozilla/reject-importGlobalProperties": "off"
      }
    }
  ]
};
