/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Production modules must form an acyclic dependency graph.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$",
        "(?:^|/)generated/",
        "(?:^|/)routeTree[.]gen[.]tsx?$",
      ],
    },
    includeOnly: "^(?:apps/[^/]+/src|packages/[^/]+/src)/",
    moduleSystems: ["es6", "cjs"],
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
