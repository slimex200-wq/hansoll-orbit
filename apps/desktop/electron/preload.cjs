const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opencrab", {
  setWindowTheme: (theme) => ipcRenderer.invoke("window:set-theme", theme),
  toggleWindowMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  audit: () => ipcRenderer.invoke("opencrab:audit"),
  getBusinessIndexStatus: () => ipcRenderer.invoke("opencrab:index-status"),
  initializeBusinessIndexes: () => ipcRenderer.invoke("opencrab:initialize-indexes"),
  onBusinessIndexStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("opencrab:index-status-changed", listener);
    return () => ipcRenderer.removeListener("opencrab:index-status-changed", listener);
  },
  getAgentStatus: () => ipcRenderer.invoke("opencrab:agent-status"),
  selectAgentProvider: (providerId, model) =>
    ipcRenderer.invoke("opencrab:agent-provider-select", { providerId, model }),
  connectAgentProvider: (providerId) =>
    ipcRenderer.invoke("opencrab:agent-provider-connect", providerId),
  setAgentExternalDataApproval: (approved) =>
    ipcRenderer.invoke("opencrab:agent-external-data-approval", approved),
  runAgent: (query) => ipcRenderer.invoke("opencrab:judge", query),
  executeAgentActions: (reviewToken, actionIds) =>
    ipcRenderer.invoke("opencrab:execute-agent-actions", { reviewToken, actionIds }),
  search: (query) => ipcRenderer.invoke("opencrab:search", query),
  openPath: (filePath) => ipcRenderer.invoke("opencrab:open-path", filePath),
  openOutlookMail: (input) => ipcRenderer.invoke("opencrab:open-outlook-mail", input),
  showItemInFolder: (filePath) => ipcRenderer.invoke("opencrab:show-item", filePath),
  getLinkedFolders: () => ipcRenderer.invoke("folders:list"),
  chooseLinkedFolder: () => ipcRenderer.invoke("folders:choose"),
  refreshLinkedFolder: (id) => ipcRenderer.invoke("folders:refresh", id),
  removeLinkedFolder: (id) => ipcRenderer.invoke("folders:remove", id),
  onLinkedFoldersChanged: (callback) => {
    const listener = (_event, folders) => callback(folders);
    ipcRenderer.on("folders:changed", listener);
    return () => ipcRenderer.removeListener("folders:changed", listener);
  },
  getBuyerContext: () => ipcRenderer.invoke("buyer-context:get"),
  confirmBuyerContext: (input) => ipcRenderer.invoke("buyer-context:confirm", input),
  selectBuyerContext: (buyerId) => ipcRenderer.invoke("buyer-context:select", buyerId),
  onBuyerContextChanged: (callback) => {
    const listener = (_event, context) => callback(context);
    ipcRenderer.on("buyer-context:changed", listener);
    return () => ipcRenderer.removeListener("buyer-context:changed", listener);
  },
  getState: () => ipcRenderer.invoke("domain:get-state"),
  getLocalStateHealth: () => ipcRenderer.invoke("domain:get-health"),
  exportLocalStateBackup: () => ipcRenderer.invoke("domain:export-backup"),
  restoreLocalStateBackup: () => ipcRenderer.invoke("domain:restore-backup"),
  createCase: (input) => ipcRenderer.invoke("domain:create-case", input),
  createCaseWithTasks: (input) =>
    ipcRenderer.invoke("domain:create-case-with-tasks", input),
  updateCase: (input) => ipcRenderer.invoke("domain:update-case", input),
  deleteCase: (id) => ipcRenderer.invoke("domain:delete-case", id),
  createTask: (input) => ipcRenderer.invoke("domain:create-task", input),
  updateTask: (input) => ipcRenderer.invoke("domain:update-task", input),
  deleteTask: (id) => ipcRenderer.invoke("domain:delete-task", id),
  createMilestone: (input) => ipcRenderer.invoke("domain:create-milestone", input),
  updateMilestone: (input) => ipcRenderer.invoke("domain:update-milestone", input),
  deleteMilestone: (id) => ipcRenderer.invoke("domain:delete-milestone", id),
  createDecision: (input) => ipcRenderer.invoke("domain:create-decision", input),
  updateDecision: (input) => ipcRenderer.invoke("domain:update-decision", input),
  deleteDecision: (id) => ipcRenderer.invoke("domain:delete-decision", id),
  createArtifactJob: (input) => ipcRenderer.invoke("domain:create-artifact-job", input),
  getMicrosoftStatus: () => ipcRenderer.invoke("microsoft:get-status"),
  signInMicrosoft: () => ipcRenderer.invoke("microsoft:sign-in"),
  syncMicrosoftMail: () => ipcRenderer.invoke("microsoft:sync-mail"),
  signOutMicrosoft: () => ipcRenderer.invoke("microsoft:sign-out"),
  onMicrosoftStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("microsoft:status-changed", listener);
    return () => ipcRenderer.removeListener("microsoft:status-changed", listener);
  },
  getTemplateRegistry: () => ipcRenderer.invoke("artifact:templates"),
  resolveArtifactTemplate: (input) =>
    ipcRenderer.invoke("artifact:resolve-template", input),
  chooseWorkbook: () => ipcRenderer.invoke("artifact:choose-workbook"),
  copyArtifact: (jobId) => ipcRenderer.invoke("artifact:copy-template", jobId),
  validateArtifact: (jobId, specName) =>
    ipcRenderer.invoke("artifact:validate", jobId, specName),
  approveArtifact: (jobId) => ipcRenderer.invoke("artifact:approve", jobId),
});
