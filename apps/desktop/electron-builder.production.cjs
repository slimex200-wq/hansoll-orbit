module.exports = {
  appId: "com.hansoll.orbit",
  productName: "HANSOLL ORBIT",
  directories: {
    output: process.env.ORBIT_BUILD_OUTPUT || "release/production-build",
    buildResources: "build",
  },
  files: [
    "dist/**/*",
    "electron/**/*",
    "!electron/*.test.cjs",
    "package.json",
  ],
  extraResources: [
    {
      from: "native/backend/dist/opencrab-backend.exe",
      to: "native/opencrab-backend.exe",
    },
    {
      from: "native/wam-broker/dist/opencrab-wam-broker.exe",
      to: "native/opencrab-wam-broker.exe",
    },
    {
      from: "electron/outlook-desktop.ps1",
      to: "native/outlook-desktop.ps1",
    },
    {
      from: "../../knowledge/buyers",
      to: "runtime/knowledge/buyers",
    },
    {
      from: "../../knowledge/talbots_workflow_rules.md",
      to: "runtime/knowledge/talbots_workflow_rules.md",
    },
    {
      from: "../../knowledge/opencrab_9spaces_grammar.md",
      to: "runtime/knowledge/opencrab_9spaces_grammar.md",
    },
    {
      from: "../../knowledge/work_agent_quality.schema.json",
      to: "runtime/knowledge/work_agent_quality.schema.json",
    },
    {
      from: "../../knowledge/work_agent_synthesis.schema.json",
      to: "runtime/knowledge/work_agent_synthesis.schema.json",
    },
    {
      from: "../../knowledge/work_agent_summary_synthesis.schema.json",
      to: "runtime/knowledge/work_agent_summary_synthesis.schema.json",
    },
    {
      from: "../../knowledge/workbook_layout_specs",
      to: "runtime/knowledge/workbook_layout_specs",
    },
  ],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: "HANSOLL-ORBIT-${version}-${arch}.${ext}",
    executableName: "HANSOLL ORBIT",
    icon: "build/icon.ico",
    requestedExecutionLevel: "asInvoker",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  portable: { unicode: true },
};
