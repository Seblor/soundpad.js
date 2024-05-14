import net from 'net'
import { exec, execSync } from 'child_process'
import iconv from 'iconv-lite';

/**
 * Get the path of the soundpad exe file or null if it could not be found
 */
export function getSoundpadPath (): string | null {
  // Send exception if the OS is not windows
  if (process.platform !== 'win32') { throw new Error('This function is only available on Windows') }

  try {
    // Returns multiple lines including the path: `    (Default)    REG_SZ    "C:\Program Files\Soundpad\Soundpad.exe" -c "%1"`
    const result = iconv.decode(execSync(
      'cmd /c chcp.com 65001>nul && REG QUERY HKEY_CLASSES_ROOT\\Soundpad\\shell\\open\\command',
      { stdio: ['ignore', 'pipe', 'ignore'] } // Ignoring stdin and stdout
    ), 'utf-8')
    const match = result.match(/"(.*soundpad.exe)"/i) // Get the path (without the quotes)
    if (match == null) throw new Error('Could not find Soundpad path')
    return match[1]
  } catch (error) {
    return null
  }
}

export async function openSoundpad (checkBeforeOpen = false): Promise<void> {
  if (checkBeforeOpen && await isSoundpadOpened(false)) return
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

export async function closeSoundpad (): Promise<void> {
  exec('taskkill /FI "IMAGENAME eq Soundpad.exe" /F /T')
  await waitForPipe()
}
