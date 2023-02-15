# Soundpad.js

An npm package for interacting with Soundpad

# Install

`npm install --save soundpad`

# Usage

```js
import Soundpad from 'soundpad.js';
import { getSoundpadPath, openSoundpad } from 'soundpad.js';

console.log(getSoundpadPath())

async function run () {
  await openSoundpad()

  await Soundpad.connect()

  await Soundpad.playSound(1)

  Soundpad.disconnect()
}

run()
```

# Notes

The module exports a singleton, so you can just require it and use it as an instance of a class.

This package is mainly a porting of https://www.leppsoft.com/soundpad/files/rc/SoundpadRemoteControl.java to Typescript, with some utility functions added.
