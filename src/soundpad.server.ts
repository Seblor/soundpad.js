import * as fcts from './functions.js'
import Soundpad from './soundpad.js'

class SoundpadServer extends Soundpad {
  protected async openSoundpad (): Promise<void> {
    await fcts.openSoundpad(true)
  }
}

// const soundpad = new Soundpad()

export default SoundpadServer
