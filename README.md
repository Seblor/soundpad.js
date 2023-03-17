# Soundpad.js

An npm package for interacting with Soundpad

# Install

`npm install --save soundpad.js`

# Usage

```js
import Soundpad, { getSoundpadPath, openSoundpad } from 'soundpad.js';

const soundpad = new Soundpad()

console.log(getSoundpadPath())

async function run () {
  await openSoundpad()

  await soundpad.connect()

  await soundpad.playSound(1)

  soundpad.disconnect()
}

run()
```

# Notes

This package is mainly a porting of https://www.leppsoft.com/soundpad/files/rc/SoundpadRemoteControl.java to Typescript, with some utility functions added.
