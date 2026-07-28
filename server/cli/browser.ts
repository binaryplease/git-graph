/**
 * Open a URL in the operating system's default browser — the gesture the
 * on-demand CLI makes after the server is listening, so `bgg` in a terminal
 * lands the user straight in the graph.
 *
 * Per-platform launcher, detached so it outlives the CLI process. Best-effort:
 * a launcher that is absent (a headless box with no `xdg-open`) must not crash
 * the serve command — the server is already up and its URL was printed, so a
 * failed browser launch degrades to "open it yourself", never to a fatal error.
 */
type LauncherInvocation = { command: string; commandArguments: string[] }

function browserLauncherFor(targetUrl: string): LauncherInvocation {
  switch (process.platform) {
    case 'darwin':
      return { command: 'open', commandArguments: [targetUrl] }
    case 'win32':
      // `start` is a cmd builtin; the empty "" is the window-title argument it
      // consumes before the URL.
      return { command: 'cmd', commandArguments: ['/c', 'start', '', targetUrl] }
    default:
      return { command: 'xdg-open', commandArguments: [targetUrl] }
  }
}

/** Launches the browser and returns whether the launcher process could start. */
export function openUrlInBrowser(targetUrl: string): boolean {
  const { command, commandArguments } = browserLauncherFor(targetUrl)
  try {
    const launcher = Bun.spawn([command, ...commandArguments], {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    })
    launcher.unref()
    return true
  } catch {
    return false
  }
}
