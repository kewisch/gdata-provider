import js from "@eslint/js";
import globals from "globals";
import stylistic from "@stylistic/eslint-plugin";
import jest from "eslint-plugin-jest";

export default [
  {
    ignores: [
      "**/*.js",
      "!src/**/*.js",
      "!test/**/*.js",
      "!eslint.config.js",
      "!commitlint.config.js",

      "src/experiments/**",
      "!src/experiments/gdata/**/*.js",

      "src/background/libs/**",
      "test/xpcshell/**",
    ]
  },
  js.configs.recommended,
  {
    plugins: {
      "@stylistic": stylistic,
    },
    languageOptions: {
      globals: {
        ...globals.es2021,
        ...globals.webextensions,
        "messenger": true,
        "ICAL": true,
      }
    },
    rules: {
      // Enforce one true brace style (opening brace on the same line)
      // Allow single line (for now) because of the vast number of changes needed
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],

      // Enforce newline at the end of file, with no multiple empty lines.
      "@stylistic/eol-last": "error",

      // Disallow using variables outside the blocks they are defined
      "block-scoped-var": "error",

      // Allow trailing commas for easy list extension.  Having them does not
      // impair readability, but also not required either.
      "@stylistic/comma-dangle": 0,

      // Enforce spacing before and after comma
      "@stylistic/comma-spacing": ["error", { before: false, after: true }],

      // Enforce one true comma style.
      "@stylistic/comma-style": ["error", "last"],

      // We should get better at complexity, but at the moment it is what it is
      "complexity": [2, 90],

      // Enforce curly brace conventions for all control statements.
      "curly": "error",

      // Enforce the spacing around the * in generator functions.
      "@stylistic/generator-star-spacing": ["error", "after"],

      // Require space before/after arrow function's arrow
      "@stylistic/arrow-spacing": ["error", { before: true, after: true }],

      // Enforces spacing between keys and values in object literal properties.
      "@stylistic/key-spacing": ["error", { beforeColon: false, afterColon: true, mode: "minimum" }],

      // Disallow the omission of parentheses when invoking a constructor with no
      // arguments.
      "@stylistic/new-parens": "error",

      // Disallow use of the Array constructor.
      "no-array-constructor": "error",

      // disallow use of the Object constructor
      "no-object-constructor": "error",

      // Disallow Primitive Wrapper Instances
      "no-new-wrappers": "error",

      // Disallow adding to native types
      "no-extend-native": "error",

      // Disallow unnecessary semicolons.
      "@stylistic/no-extra-semi": "error",

      // Disallow mixed spaces and tabs for indentation.
      "@stylistic/no-mixed-spaces-and-tabs": "error",

      // Disallow nested ternary expressions, they make the code hard to read.
      "no-nested-ternary": "error",

      // Disallow comparisons where both sides are exactly the same.
      "no-self-compare": "error",

      // Disallow trailing whitespace at the end of lines.
      "@stylistic/no-trailing-spaces": "error",

      // disallow use of octal escape sequences in string literals, such as
      // var foo = "Copyright \251";
      "no-octal-escape": "error",

      // disallow use of void operator
      "no-void": "error",

      // Disallow Yoda conditions (where literal value comes first).
      "yoda": "error",

      // Require a space immediately following the // in a line comment.
      "@stylistic/spaced-comment": [2, "always"],

      // Require use of the second argument for parseInt().
      "radix": "error",

      // Require spaces before/after unary operators (words on by default,
      // nonwords off by default).
      "@stylistic/space-unary-ops": [2, { "words": true, "nonwords": false }],

      // Enforce spacing after semicolons.
      "@stylistic/semi-spacing": ["error", { before: false, after: true }],

      // Disallow the use of Boolean literals in conditional expressions.
      "no-unneeded-ternary": "error",

      // Disallow use of multiple spaces (sometimes used to align const values,
      // array or object items, etc.). It's hard to maintain and doesn't add that
      // much benefit.
      "@stylistic/no-multi-spaces": "error",

      // Require spaces around operators, except for a|0.
      // Disabled for now given eslint doesn't support default args yet
      "@stylistic/space-infix-ops": [2, { "int32Hint": true }],

      // Require a space around all keywords.
      "@stylistic/keyword-spacing": "error",

      // Disallow space between function identifier and application.
      "@stylistic/function-call-spacing": "error",

      // Disallow use of comma operator.
      "no-sequences": "error",

      // Disallow use of assignment in return statement. It is preferable for a
      // single line of code to have only one easily predictable effect.
      "no-return-assign": "error",

      // Require return statements to either always or never specify values
      "consistent-return": "error",

      // Disallow padding within blocks.
      "@stylistic/padded-blocks": [2, "never"],

      // Disallow spaces inside parentheses.
      "@stylistic/space-in-parens": ["error", "never"],

      // Require space after keyword for anonymous functions, but disallow space
      // after name of named functions.
      "@stylistic/space-before-function-paren": ["error", { anonymous: "never", named: "never" }],

      // Always require use of semicolons wherever they are valid.
      "@stylistic/semi": ["error", "always"],

      // Warn about declaration of variables already declared in the outer scope.
      // This isn't an error because it sometimes is useful to use the same name
      // in a small helper function rather than having to come up with another
      // random name.  Still, making this a warning can help people avoid being
      // confused.
      "no-shadow": "error",

      // We use var-only-at-top-level instead of no-var as we allow top level
      // vars.
      "no-var": 0,
      // "mozilla/var-only-at-top-level": 1,

      // Disallow global and local variables that aren't used, but allow unused function arguments.
      // "no-unused-vars": [2, { "vars": "all", "args": "none", "varsIgnorePattern": "EXPORTED_SYMBOLS" }],
      "no-unused-vars": 0,

      // "mozilla/mark-test-function-used": 1,

      // Require padding inside curly braces
      "@stylistic/object-curly-spacing": ["error", "always"],

      // Disallow spaces inside of brackets
      "@stylistic/array-bracket-spacing": ["error", "never"],

      // Disallow Regexs That Look Like Division
      "no-div-regex": "error",

      // Disallow Iterator (using __iterator__)
      "no-iterator": "error",

      // Enforce consistent linebreak style
      "@stylistic/linebreak-style": ["error", "unix"],

      // Enforces return statements in callbacks of array's methods
      "array-callback-return": "error",

      // Disallow duplicate imports
      "no-duplicate-imports": "error",

      // Disallow Labeled Statements
      "no-labels": "error",

      // Disallow Multiline Strings
      "no-multi-str": "error",

      // Disallow Initializing to undefined
      "no-undef-init": "error",

      // Disallow unnecessary computed property keys on objects
      "no-useless-computed-key": "error",

      // Disallow unnecessary constructor
      "no-useless-constructor": "error",

      // Disallow renaming import, export, and destructured assignments to the
      // same name
      "no-useless-rename": "error",

      // Enforce spacing between rest and spread operators and their expressions
      "@stylistic/rest-spread-spacing": ["error", "never"],

      // Disallow usage of spacing in template string expressions
      "@stylistic/template-curly-spacing": ["error", "never"],

      // Disallow the Unicode Byte Order Mark
      "unicode-bom": [2, "never"],

      // Enforce spacing around the * in yield* expressions
      "@stylistic/yield-star-spacing": ["error", "after"],

      // Disallow Implied eval
      "no-implied-eval": "error",

      // Disallow unnecessary function binding
      "no-extra-bind": "error",

      // Disallow new For Side Effects
      "no-new": "error",

      // Require IIFEs to be Wrapped
      "@stylistic/wrap-iife": [2, "inside"],

      // Disallow Unused Expressions
      "no-unused-expressions": "error",

      // Disallow function or var declarations in nested blocks
      "no-inner-declarations": "error",

      // Enforce newline before and after dot
      "@stylistic/dot-location": ["error", "property"],

      // Disallow Use of caller/callee
      "no-caller": "error",

      // Disallow Floating Decimals
      "@stylistic/no-floating-decimal": "error",

      // Require Space Before Blocks
      "@stylistic/space-before-blocks": "error",

      // Operators always before the line break
      "@stylistic/operator-linebreak": ["error", "after", { overrides: { ":": "before", "?": "ignore" } }],

      // Restricts the use of parentheses to only where they are necessary
      // Disabled for now since this also removes parens around assignments, e.g. let foo = bar == baz
      // "no-extra-parens": [2, "all", { "conditionalAssign": false, "returnAssign": false, "nestedBinaryExpressions": false }],

      // Double quotes should be used.
      "@stylistic/quotes": [2, "double", { "avoidEscape": true }],

      // Disallow if as the only statement in an else block.
      "no-lonely-if": "error",

      // Not more than two empty lines with in the file, and no extra lines at
      // beginning or end of file.
      "@stylistic/no-multiple-empty-lines": ["error", { max: 2, maxEOF: 0, maxBOF: 0 }],

      // Make sure all setters have a corresponding getter
      "accessor-pairs": "error",

      // Enforce spaces inside of single line blocks
      "@stylistic/block-spacing": [2, "always"],

      // Disallow spaces inside of computed properties
      "@stylistic/computed-property-spacing": ["error", "never"],

      // Require consistent this (using |self|)
      "consistent-this": [2, "self"],

      // Disallow unnecessary .call() and .apply()
      "no-useless-call": "error",

      // Require dot notation when accessing properties
      "dot-notation": "error",

      // Disallow named function expressions
      "func-names": [2, "never"],

      // Enforce placing object properties on separate lines
      "@stylistic/object-property-newline": ["error", { allowAllPropertiesOnSameLine: true }],

      // Do Not Require Object Literal Shorthand Syntax
      // (Override the parent eslintrc setting for this.)
      "object-shorthand": "off",

      // Disallow whitespace before properties
      "@stylistic/no-whitespace-before-property": "error",

      // Disallow mixes of different operators, but allow simple math operations.
      "@stylistic/no-mixed-operators": [
        2,
        {
          "groups": [
            /* ["+", "-", "*", "/", "%", "**"], */
            ["&", "|", "^", "~", "<<", ">>", ">>>"],
            ["==", "!=", "===", "!==", ">", ">=", "<", "<="],
            ["&&", "||"],
            ["in", "instanceof"]
          ]
        }
      ],

      // Disallow unnecessary concatenation of strings
      "no-useless-concat": "error",

      // Disallow unmodified conditions of loops
      "no-unmodified-loop-condition": "error",

      // Suggest using arrow functions as callbacks
      "prefer-arrow-callback": [2, { "allowNamedFunctions": true }],

      // Suggest using the spread operator instead of .apply()
      "prefer-spread": "error",

      // Disallow negated conditions
      "no-negated-condition": "error",

      // Enforce a maximum number of statements allowed per line
      "@stylistic/max-statements-per-line": ["error", { max: 2 }],

      // Disallow arrow functions where they could be confused with comparisons
      "@stylistic/no-confusing-arrow": "error",

      // No console messages
      "no-console": "error",

      // Disallow Unnecessary Nested Blocks
      "no-lone-blocks": "error",

      // Enforce minimum identifier length
      "id-length": [
        2,
        {
          "min": 3,
          "exceptions": [
            /* sorting */
            "a",
            "b",
            /* exceptions */
            "e",
            "ex",
            /* loop indices */
            "i",
            "j",
            "k",
            "n",
            /* coordinates */
            "x",
            "y",
            /* regexes */
            "re",
            /* known words */
            "rc",
            "rv",
            "id",
            "OS",
            "os",
            "db",
            "is",
            "qs",
            /* mail/calendar words */
            "to",
            "cc",
            /* Components */
            "Ci",
            "Cc",
            "Cu",
            "Cr",
            /* npm modules */
            "v8",
            "fs"
          ]
        }
      ],

      // The following rules will not be enabled currently, but are kept here for
      // easier updates in the future.
      "no-else-return": 0
    }
  },
  {
    files: [
      "src/content/**/*.js",
      "src/options/**/*.js",
      "src/background/**/*.js",
      "src/onboarding/**/*.js",
    ],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },
  {
    files: ["src/experiments/**/*.js", "src/legacy/**/*.mjs"],
    languageOptions: {
      globals: {
        Cr: true,
        Ci: true,
        Cu: true,
        Cc: true,
        ChromeUtils: true,
        Services: true,
        console: true,
        fetch: true,
        ImageDecoder: true
      }
    }
  },
  {
    files: ["test/**/*.js"],
    plugins: {
      "jest": jest,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jest,
        ...globals.node,
      }
    },

    rules: {
      ...jest.configs["flat/recommended"].rules,

      // Tests will have console messages
      "no-console": "off"
    }
  },
  {
    files: ["eslint.config.js"],
    rules: {
      "id-length": "off"
    }
  }
];
