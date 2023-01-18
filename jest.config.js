// @ts-check
/** @type {import("jest").Config} */
const config = {
	preset: "ts-jest",
	collectCoverage: true,
	coverageThreshold: {
		global: {
			branches: 100,
			functions: 100,
			lines: 100,
			statements: 100,
		},
	},
};
module.exports = config;
