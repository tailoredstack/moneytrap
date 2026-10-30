module.exports = {
  forbidden: [
    {
      name: "domain-no-workspace-imports",
      severity: "error",
      from: { path: "^packages/domain/" },
      to: { path: "^(?:packages/(?!domain/)|apps/)" },
    },
    {
      name: "domain-no-core-imports",
      severity: "error",
      from: { path: "^packages/domain/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "domain-no-framework-imports",
      severity: "error",
      from: { path: "^packages/domain/" },
      to: { path: "(?:^|/)(?:elysia|@elysiajs)(?:/|$)" },
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
      to: { path: "(?:^|/)(?:redis|@redis/client|elysia)(?:/|$)" },
    },
    {
      name: "adapters-no-cross-imports",
      severity: "error",
      from: { path: "^packages/adapter-([^/]+)/" },
      to: { path: "^packages/adapter-", pathNot: "^packages/adapter-$1/" },
    },
    {
      name: "web-only-contracts-and-ui",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^(?:packages/(?!contracts/|ui/)|apps/(?!web/))" },
    },
    {
      name: "ui-only-contracts",
      severity: "error",
      from: { path: "^packages/ui/" },
      to: { path: "^(?:packages/(?!contracts/|ui/)|apps/)" },
    },
    {
      name: "adapters-only-from-server",
      severity: "error",
      from: { path: "^(?!apps/server/|packages/adapter-|packages/conformance/)" },
      to: { path: "^packages/adapter-" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
  },
};
