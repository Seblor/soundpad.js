import net from 'net'
import { exec, execSync } from 'child_process'

/**
 * Get the path of the soundpad exe file or null if it could not be found
 */
export function getSoundpadPath (): string | null {
  // Send exception if the OS is not windows
  if (process.platform !== 'win32') { throw new Error('This function is only available on Windows') }

  try {
    // Returns multiple lines including the path: `    (Default)    REG_SZ    "C:\Program Files\Soundpad\Soundpad.exe" -c "%1"`
    const result = execSync(
      'REG QUERY HKEY_CLASSES_ROOT\\Soundpad\\shell\\open\\command',
      { stdio: ['ignore', 'pipe', 'ignore'] } // Ignoring stdin and stdout
    ).toString()
    const match = result.match(/"(.*soundpad.exe)"/i) // Get the path (without the quotes)
    if (match == null) throw new Error('Could not find Soundpad path')
    return match[1]
  } catch (error) {
    return null
  }
}

export async function openSoundpad (): Promise<void> {
  exec(`"${getSoundpadPath()}"`)
  await waitForPipe()
}

/**
 * Wait for Soundpad's named pipe (`//./pipe/sp_remote_control`) to be created
 */
export async function waitForPipe (): Promise<void> {
  return await new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const pipe = net
        .createConnection('//./pipe/sp_remote_control', () => {
          clearInterval(checkInterval)
          pipe.end()
          resolve()
        })
        .on('error', () => {
          /* Ignore error */
        })
    }, 100)
  })
}

/**
 * Check if there is a process of the soundpad exe file running
 */
export async function isSoundpadOpened (checkPipe = true): Promise<boolean> {
  // Send exception if the OS is not windows
  if (process.platform !== 'win32') { throw new Error('This function is only available on Windows') }
  const result = execSync(
    'tasklist /FI "IMAGENAME eq Soundpad.exe"'
  ).toString()
  const isProcessRunning = result.includes('Soundpad.exe')
  if (checkPipe) {
    const isPipeOpened: boolean = await new Promise((resolve) => {
      const pipe = net
        .createConnection('//./pipe/sp_remote_control', () => {
          pipe.end()
          resolve(true)
        })
        .on('error', () => {
          pipe.end()
          resolve(false)
        })
    })
    return isPipeOpened && isProcessRunning
  }
  return isProcessRunning
}
