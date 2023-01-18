// @ts-check
/** @type {import("eslint").Linter.Config} */
const config = {
	root: true,
	env: { node: true },
	parser: "@typescript-eslint/parser",
	parserOptions: {
		tsconfigRootDir: __dirname,
		project: ["./tsconfig.eslint.json"],
	},
	ignorePatterns: ["*.d.ts"],
	plugins: ["@typescript-eslint", "prettier"],
	extends: [
		"eslint:recommended",
		"plugin:@typescript-eslint/eslint-recommended",
		"plugin:@typescript-eslint/recommended",
		"plugin:@typescript-eslint/recommended-requiring-type-checking",
	],
	rules: {
		"@typescript-eslint/no-base-to-string": 2,
		"@typescript-eslint/no-implicit-any-catch": 2,
		"@typescript-eslint/no-invalid-this": 2,
		"@typescript-eslint/no-throw-literal": 2,
		"@typescript-eslint/no-unsafe-argument": 2,
		"@typescript-eslint/prefer-includes": 2,
		"@typescript-eslint/prefer-readonly": 2,
		"@typescript-eslint/require-await": 0,
		"@typescript-eslint/return-await": 2,
		"no-console": 2,
		"no-sequences": 2,
		"prettier/prettier": 2,
	},
};
module.exports = config;
