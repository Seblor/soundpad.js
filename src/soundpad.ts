import net from 'net'
import xml from 'xml2js'
// Disabling eslint rule for resolving package.json during build
// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require('../package.json')

enum PlayStatus {
  STOPPED = 'STOPPED',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  SEEKING = 'SEEKING'
}

interface SoundType {
  index: number
  url: string
  artist: string
  title: string
  duration: string
  addedOn: string
  lastPlayedOn: string
  playCount: number
}

// Soundpad's native response to sounds list query (after XML -> JS conversion)
interface SPSoundlistResponseType {
  Soundlist: {
    Sound: Array<{
      $: SoundType
    }>
  }
}

// Soundpad's native response to category query (after XML -> JS conversion)
interface CategoryType {
  index: number
  type?: number
  name: string
  hidden?: boolean
  sounds?: SoundType[]
}

// Soundpad's native response to categories query (after XML -> JS conversion)
interface SPCategoriesResponseType {
  Categories: {
    Category: Array<{
      $: CategoryType
      Sound: Array<{
        $: SoundType
      }>
    }>
  }
}

class Soundpad {
  private _pipe: net.Socket | null = null
  clientVersion = ''
  private readonly connexionPromise: Promise<boolean> | null = null
  private connexionResolveFunction: (value: boolean | PromiseLike<boolean>) => void = () => { }
  isConnected: boolean

  constructor () {
    this.isConnected = false
    this.connexionPromise = new Promise(resolve => {
      this.connexionResolveFunction = resolve
    })
  }

  async connect (): Promise<boolean> {
    return await new Promise((resolve, reject) => {
      this._pipe = net.createConnection(
        '//./pipe/sp_remote_control',
        () => {
          this.isConnected = true
          this.connexionResolveFunction(true)
          resolve(true)
        }
      )

      this._pipe.on('error', (error) => {
        this._pipe = null
        this.isConnected = false
        reject(error)
      })

      this._pipe.on('close', () => {
        this.isConnected = false
        this._pipe = null
      })

      this._pipe.on('end', () => {
        this.isConnected = false
        this._pipe = null
      })

      this._pipe.on('timeout', () => {
        this.isConnected = false
        this._pipe = null
      })
    })
  }

  disconnect (): void {
    this._pipe?.end()
  }

  private async isSuccess (response: string | Promise<string>): Promise<boolean> {
    return (await response).toString().startsWith('R-200')
  }

  async sendQuery (query: string): Promise<string> {
    if (this._pipe === null) {
      throw new Error('Please connect the pipe before sending a message')
    }

    await this.connexionPromise

    return await new Promise((resolve) => {
      this._pipe?.write(query)
      this._pipe?.once('data', (buffer) => {
        resolve(buffer.toString())
      })
    })
  }

  async getSoundListJSON (): Promise<SoundType[] | undefined> {
    const response = await this.sendQuery('GetSoundlist()')
    if (response !== undefined) {
      const parsed = (await xml.parseStringPromise(
        response
      )) as SPSoundlistResponseType

      return parsed.Soundlist.Sound.map(sound => sound.$)
    }
  }

  // private formatCategory (category: CategoryType): CategoryType {
  // }

  /**
   * Get the category tree.
   *
   * @param {boolean} withSounds includes all sound entries of each category into the response
   * @param {boolean} withIcons base64 encoded PNGs
   * @return {Promise<CategoryType[]>} category list
   */
  public async getCategoriesJSON (withSounds: boolean, withIcons: boolean): Promise<CategoryType[]> {
    const response = await this.sendQuery(`GetCategories(${withSounds}, ${withIcons})`)
    if (response.startsWith('R')) {
      console.error(response)
    }
    if (response !== undefined) {
      const parsed = (await xml.parseStringPromise(
        response
      )) as SPCategoriesResponseType

      return parsed.Categories.Category.map(category => category.$)
    }

    return []
  }

  /**
   * Get a category identified by its index. Use
   * {@link #getCategoriesJSON(boolean, boolean)} to get the index.
   *
   * @param {number} categoryIndex
   * @param {boolean} withSounds includes all sound entries of each category into the response
   * @param {boolean} withIcons base64 encoded PNGs
   * @return {Promise<CategoryType | null>} category list
   */
  public async getCategoryJSON (categoryIndex: number, withSounds: boolean, withIcons: boolean): Promise<CategoryType | null> {
    const response = await this.sendQuery(`GetCategory(${categoryIndex}, ${withSounds}, ${withIcons})`)
    if (response.startsWith('R')) {
      console.error(response)
      return null
    }
    if (response !== undefined) {
      const parsed = (await xml.parseStringPromise(
        response
      )) as SPCategoriesResponseType

      const returnedObject = {
        ...parsed.Categories.Category[0].$
      }

      if (withSounds && parsed.Categories.Category[0].Sound !== undefined) {
        return {
          ...returnedObject,
          sounds: parsed.Categories.Category[0].Sound.map(sound => sound.$)
        }
      }

      return returnedObject
    }

    return null
  }

  /**
   * Porting from https://www.leppsoft.com/soundpad/files/rc/SoundpadRemoteControl.java
   *
   * =========== PORTING START ===========
   */

  /**
   * Play a sound by index.
   *
   * @param {number} index Get the index by calling {@link #getSoundlist()} first.
   * @return {boolean} true on success
   */
  public async playSound (index: number): Promise<boolean>

  /**
   * Extends {@link #playSound(index: number)} by the ability to determine on which lines the sound shall be played.
   *
   * @param {number} index Get the index by calling {@link #getSoundlist()} first.
   * @param {boolean} renderLine set to true to play on speakers so you hear it.
   * @param {boolean} captureLine set to true to play on microphone so others hear it.
   * @return {boolean} true on success
   */
  public async playSound (index: number, renderLine?: boolean, captureLine?: boolean): Promise<boolean> {
    if (renderLine === undefined || captureLine === undefined) {
      return await this.isSuccess(this.sendQuery(`DoPlaySound(${index})`))
    } else {
      return await this.isSuccess(this.sendQuery(`DoPlaySound(${index}, ${(renderLine ?? true)}, ${captureLine ?? true})`))
    }
  }

  /**
   * Play previous sound in the list. The play mode is the same as it was for
   * the last played file. Means, if a sound was played on speakers only, then
   * this function will play on speakers only as well.
   */
  public async playPreviousSound (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoPlayPreviousSound()'))
  }

  /**
   * @see #playPreviousSound()
   */
  public async playNextSound (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoPlayNextSound()'))
  }

  public async stopSound (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoStopSound()'))
  }

  public async togglePause (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoTogglePause()'))
  }

  /**
   * Use negative values to jump backwards.
   *
   * @param {number} timeMillis
   * e.g. 5000 to jump 5 seconds forward.
   */
  public async jump (timeMillis: number): Promise<boolean> {
    return await this.isSuccess(this.sendQuery(`DoJumpMs(${timeMillis})`))
  }

  /**
   * Jump to a particular position in the currently played sound.
   *
   * @param {number} timeMillis
   * e.g. 5000 to jump to the 5th second of the sound.
   */
  public async seek (timeMillis: number): Promise<boolean> {
    return await this.isSuccess(this.sendQuery(`DoSeekMs(${timeMillis})`))
  }

  /**
   * Start recording. This call is handled the same way as if a recording is
   * started by hotkeys, which means a notification sound is played. This is
   * the default behavior, but the notification sound can be turned off in
   * Soundpad.
   */
  public async startRecording (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoStartRecording()'))
  }

  public async stopRecording (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoStopRecording()'))
  }

  /**
   * Uses Soundpad's instant search to highlight sounds.
   * @param {string} searchTerm
   */
  public async search (searchTerm: string): Promise<boolean> {
    const response: string = await this.sendQuery('DoSearch("' + searchTerm + '")')
    if (!(response === ('R-200'))) {
      console.error(response)
      return false
    }
    return true
  }

  /**
   * Closes search panel.
   */
  public async resetSearch (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoResetSearch()'))
  }

  /**
   * Select previous search hit. Search is always wrapped. Means it starts
   * again at the first hit if the last hit is reached.
   */
  public async selectPreviousHit (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoSelectPreviousHit()'))
  }

  /**
   * @see #selectPreviousHit()
   */
  public async selectNextHit (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoSelectNextHit()'))
  }

  /**
   * Select the sound at the given row in the list. This method was created
   * before categories were introduced, as such the row is not the sound
   * index, but the position in the currently selected category.
   * @param {number} row
   */
  public async selectRow (row: number): Promise<boolean> {
    return await this.isSuccess(this.sendQuery(`DoSelectIndex(${row})`))
  }

  /**
   * Scroll down or up by this many rows. Use negative values to scroll
   * upwards.
   * @param {number} rows
   */
  public async scrollBy (rows: number): Promise<boolean> {
    return await this.isSuccess(this.sendQuery(`DoScrollBy(${rows})`))
  }

  /**
   * Scroll to a particular row.
   * @param {number} row
   */
  public async scrollTo (row: number): Promise<boolean> {
    return await this.isSuccess(this.sendQuery(`DoScrollTo(${row})`))
  }

  /**
   * Returns the total amount of sounds over all categories independent of
   * currently selected category.
   */
  public async getSoundFileCount (): Promise<number> {
    return parseInt(await this.sendQuery('GetSoundFileCount()'))
  }

  /**
   * Returns playback position of currently played sound file in milliseconds.
   */
  public async getPlaybackPosition (): Promise<number> {
    return parseInt(await this.sendQuery('GetPlaybackPositionInMs()'))
  }

  /**
   * Returns duration of currently played sound file in milliseconds.
   */
  public async getPlaybackDuration (): Promise<number> {
    return parseInt(await this.sendQuery('GetPlaybackDurationInMs()'))
  }

  /**
   * Returns recording position in milliseconds.
   */
  public async getRecordingPosition (): Promise<number> {
    return parseInt(await this.sendQuery('GetRecordingPositionInMs()'))
  }

  /**
   * Returns current recording peak.
   */
  public async getRecordingPeak (): Promise<number> {
    return parseInt(await this.sendQuery('GetRecordingPeak()'))
  }

  /**
   * Get a section of the sound list.
   *
   * @see #getSoundlist()
   *
   * @param {number} fromIndex starts with 1
   * @param {number} toIndex the sound file at toIndex is included in the response
   * @return {string} xml formatted sound list
   */
  public async getSoundlist (fromIndex?: number, toIndex?: number): Promise<string> {
    if (toIndex !== undefined && fromIndex !== undefined) {
      return await this.sendQuery(`GetSoundlist(${fromIndex},${toIndex})`)
    } else if (fromIndex !== undefined) {
      return await this.sendQuery(`GetSoundlist(${fromIndex})`)
    }
    return await this.sendQuery('GetSoundlist()')
  }

  public async getMainFrameTitleText (): Promise<string> {
    return await this.sendQuery('GetTitleText()')
  }

  public async getStatusBarText (): Promise<string> {
    return await this.sendQuery('GetStatusBarText()')
  }

  public async getPlayStatus (): Promise<PlayStatus> {
    const response: string = await this.sendQuery('GetPlayStatus()')
    if (response.startsWith('R')) {
      console.error(response)
    }
    if (response in PlayStatus) {
      return PlayStatus[response as PlayStatus]
    }
    return PlayStatus.STOPPED
  }

  /**
   * Returns the version of Soundpad. Not the version of the remote control
   * interface.
   */
  public async getVersion (): Promise<string> {
    return await this.sendQuery('GetVersion()')
  }

  public async getRemoteControlVersion (): Promise<string> {
    return await this.sendQuery('GetRemoteControlVersion()')
  }

  /**
   * Adds a sound to the sound list.
   * @param url
   */
  public async addSound (url: string): Promise<boolean>

  /**
   * Adds a sound to the sound list.
   * @param url
   * @param index The index to add the sound to in the default category.
   */
  public async addSound (url: string, index?: number): Promise<boolean>

  /**
   * Adds a sound to the sound list.
   * @param url full path and file name, e.g. C:\mysounds\sound.mp3
   * @param index The category to add the sound to.
   * @param insertAtPosition The index to add the sound to.
   * @return {boolean} true on success
   */
  public async addSound (url: string, index?: number, insertAtPosition?: number): Promise<boolean> {
    if (insertAtPosition !== undefined && index !== undefined) {
      return await this.isSuccess(this.sendQuery(`DoAddSound("${url}", ${index}, ${insertAtPosition})`))
    } else if (index !== undefined) {
      return await this.isSuccess(this.sendQuery(`DoAddSound("${url}", ${index})`))
    }
    return await this.isSuccess(this.sendQuery(`DoAddSound("${url}")`))
  }

  public async removeSelectedEntries (removeOnDiskToo = false): Promise<boolean> {
    return await this.isSuccess(this.sendQuery(`DoRemoveSelectedEntries(${removeOnDiskToo})`))
  }

  /**
   * Undo last action. Same as Edit > Undo in Soundpad.
   */
  public async undo (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoUndo()'))
  }

  /**
   * Redo last action. Same as Edit > Redo in Soundpad.
   */
  public async redo (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoRedo()'))
  }

  /**
   * Shows file selection dialog if sound list was never saved before.
   */
  public async saveSoundlist (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoSaveSoundlist()'))
  }

  /**
   * @return {Promise<number>} volume between 0 and 100.
   */
  public async getVolume (): Promise<number> {
    const response: string = await this.sendQuery('GetVolume()')
    return parseInt(response)
  }

  /**
   * @return {Promise<boolean>} true if the volume of the speakers is 0 or muted.
   */
  public async isMuted (): Promise<boolean> {
    const response: string = await this.sendQuery('IsMuted()')
    return parseInt(response) === 1
  }

  /**
   * Change volume of the speakers.
   *
   * @param {number} volume
   * a value between 0 and 100.
   */
  public async setVolume (volume: number): Promise<boolean> {
    return await this.isSuccess(this.sendQuery(`SetVolume(${volume})`))
  }

  /**
   * Mutes or unmutes speakers in Soundpad.
   */
  public async toggleMute (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoToggleMute()'))
  }

  /**
   * @return {Promise<boolean>} true if this client class uses the same remote control interface
   * version as Soundpad.
   */
  public async isCompatible (): Promise<boolean> {
    this.clientVersion = await this.getRemoteControlVersion()
    return packageJson.version === this.clientVersion
  }

  /**
   * @return {boolean} true if Soundpad is running and the remote control interface is accessible.
   */
  public async isAlive (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('IsAlive()'))
  }

  public async playSelectedSound (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoPlaySelectedSound()'))
  }

  public async playCurrentSoundAgain (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoPlayCurrentSoundAgain()'))
  }

  public async playPreviouslyPlayedSound (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoPlayPreviouslyPlayedSound()'))
  }

  public async addCategory (name: string, parentCategoryIndex = -1): Promise<boolean> {
    return await this.isSuccess(this.sendQuery(`DoAddCategory("${name}", ${parentCategoryIndex})`))
  }

  /**
   * Start recording of the speakers. Method might fail if the microphone is
   * currently being recorded. This call is handled the same way as if a
   * recording is started by hotkeys, which means a notification sound is
   * played. This is the default behavior, but the notification sound can be
   * turned off in Soundpad.
   *
   * @return {Promise<boolean>} true if recording was started or was already running
   */
  public async startRecordingSpeakers (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoStartRecordingSpeakers()'))
  }

  /**
   * Start recording of the microphone. Method might fail if the speakers are
   * currently being recorded. This call is handled the same way as if a
   * recording is started by hotkeys, which means a notification sound is
   * played. This is the default behavior, but the notification sound can be
   * turned off in Soundpad.
   *
   * @return {Promise<boolean>} true if recording was started or was already running
   */
  public async startRecordingMicrophone (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoStartRecordingMicrophone()'))
  }

  /**
   * Select the category identified by its index. Use
   * {@link #getCategories(boolean, boolean)} to get the index.
   *
   * @param {number} categoryIndex The index of the category to be selected.
   * @return {Promise<boolean>} true on success
   */
  public async selectCategory (categoryIndex: number): Promise<boolean> {
    return await this.isSuccess(this.sendQuery(`DoSelectCategory(${categoryIndex})`))
  }

  public async selectPreviousCategory (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoSelectPreviousCategory()'))
  }

  public async selectNextCategory (): Promise<boolean> {
    return await this.isSuccess(this.sendQuery('DoSelectNextCategory()'))
  }

  /**
   * Remove a category identified by its index. Use
   * {@link #getCategories(boolean, boolean)} to get the index.
   *
   * @param {number} categoryIndex The index of the category to be removed.
   * @return {Promise<boolean>} true on success
   */
  public async removeCategory (categoryIndex: number): Promise<boolean> {
    return await this.isSuccess(this.sendQuery(`DoRemoveCategory(${categoryIndex})`))
  }

  /**
   * Get the category tree.
   *
   * @param {boolean} withSounds includes all sound entries of each category into the response
   * @param {boolean} withIcons base64 encoded PNGs
   * @return {Promise<string>} xml formatted category list
   */
  public async getCategories (withSounds: boolean, withIcons: boolean): Promise<string> {
    const response: string = await this.sendQuery(`GetCategories(${withSounds}, ${withIcons})`)
    if (response.startsWith('R')) {
      console.error(response)
    }
    return response
  }

  /**
   * Get a category identified by its index. Use
   * {@link #getCategories(boolean, boolean)} to get the index.
   *
   * @param {number} categoryIndex
   * @param {boolean} withSounds includes all sound entries associated to that category
   * @param {boolean} withIcons base64 encoded PNG
   * @return {Promise<string>} xml formatted category list
   */
  public async getCategory (categoryIndex: number, withSounds: boolean, withIcons: boolean): Promise<string> {
    const response: string = await this.sendQuery(`GetCategory(${categoryIndex}, ${withSounds}, ${withIcons})`)
    if (response.startsWith('R')) {
      console.error(response)
    }
    return response
  }

  /**
   * Let Soundpad play a sound from a particular category.
   *
   * @param {number} categoryIndex set to -1 to play a sound from the currently selected category or use {@link #getCategories(boolean, boolean)} to find the index of a category.
   * @param {number} soundIndex it's not the index as used in {@link #playSound(int)}, but the position in the category, e.g. 5 = 5th sound in the category.
   * @param {boolean} renderLine set to true to play on speakers so you hear it.
   * @param {boolean} captureLine set to true to play on microphone so others hear it.
   * @return {Promise<boolean>} true on success
   */
  public async playSoundFromCategory (categoryIndex: number, soundIndex: number, renderLine: boolean, captureLine: boolean): Promise<boolean> {
    return await this.isSuccess(this.sendQuery(`DoPlaySoundFromCategory(${categoryIndex}, ${soundIndex}, ${renderLine}, ${captureLine})`))
  }

  /**
   * =========== PORTING END ===========
   */

  /**
   * @param status The status to wait for (default: STOPPED)
   * @param pollInterval The interval to poll the status (default: 100ms)
   * @returns A promise that resolves when the status is reached
   */
  async waitForStatus (status = PlayStatus.STOPPED, pollInterval = 100): Promise<void> {
    return await new Promise((resolve) => {
      const interval = setInterval(async () => {
        const status = await this.getPlayStatus()
        if (status === PlayStatus.STOPPED) {
          clearInterval(interval)
          resolve()
        }
      }, pollInterval)
    })
  }
}

const soundpad = new Soundpad()

export default soundpad
