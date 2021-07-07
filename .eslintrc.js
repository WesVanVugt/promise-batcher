module.exports = {
    root: true,
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
        "@typescript-eslint/no-implicit-any-catch": 2,
        "@typescript-eslint/require-await": 0,
        "no-console": 2,
        "no-sequences": 2,
        "prettier/prettier": 2,
    },
};
