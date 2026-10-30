module.exports = {
  forbidden: [
    {
      name: "domain-no-workspace-imports",
      severity: "error",
      from: { path: "^packages/domain/" },
      to: { path: "^(?:packages/(?!domain/)|apps/)" },
    },
    {
      name: "app-only-domain-and-schema",
      severity: "error",
      from: { path: "^packages/app/" },
      to: { path: "^(?:packages/(?!app/|domain/|schema/)|apps/)" },
    },
    {
      name: "app-schema-types-only",
      severity: "error",
      from: { path: "^packages/app/" },
      to: { path: "^packages/schema/", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "app-no-redis-or-elysia",
      severity: "error",
      from: { path: "^packages/app/" },
      to: { path: "(?:^|/)(?:redis|elysia)(?:/|$)" },
    },
    {
      name: "adapters-no-cross-imports",
      severity: "error",
      from: { path: "^packages/adapter-([^/]+)/" },
      to: { path: "^packages/adapter-", pathNot: "^packages/adapter-$1/" },
    },
    {
      name: "web-only-contracts",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^(?:packages/(?!contracts/)|apps/(?!web/))" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
  },
};
