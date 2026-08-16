/**
 * Describe how to start the long-lived supervisor on each desktop platform.
 * The caller owns the actual spawn and the platform-specific output adapter.
 */
export function createSupervisorLaunch({
  platform,
  execPath,
  supervisorPath,
  encodedConfig,
  cwd
}) {
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/c", "start", "\"\"", "/min", execPath, supervisorPath, encodedConfig],
      cwd,
      output: "discard",
      detached: true,
      windowsHide: true
    };
  }
  return {
    command: execPath,
    args: [supervisorPath, encodedConfig],
    cwd,
    output: "log",
    detached: true,
    windowsHide: true
  };
}
