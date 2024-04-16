# Soundpad.js

<a href="https://npmjs.org/package/soundpad.js" title="View this project on NPM"><img src="https://img.shields.io/npm/v/soundpad.js.svg" alt="NPM version" /></a>

An npm package for interacting with Soundpad

# Install

`npm install --save soundpad.js`

# Usage

## Basic example

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

## Using in the browser

If you plan to use this package in the browser (with a custom dataDriver), you may get an error because some functions need Node's 'child_process' module. To fix this, you can import soundpad.js with the secondary entry point `soundpad.js/web` (which does not export those functions) like in this example:

```js
import Soundpad from 'soundpad.js/lib/web';

const soundpad = new Soundpad();

soundpad.connect((query) => {
  return fetch('/api/soundpad/', { method: 'POST', body: query })
    .then((data) => data.text())
});
```

# Changelog

Changes marked with ❌ are breaking changes

## 2.0.0

- Fixed the `Soundpad.waitForStatus()` function
- Added a secondary entry point `soundpad.js/web`
- Exporting the `PlayStatus` enum
- Correctly updating the `Soundpad.isConnected` property when using a custom dataDriver
- Exposed the previously private property `Soundpad.connectionAwaiter`, which is a promise that resolves when the connection is established.
- ❌ Renamed multiple types to remove the "Type" suffix
- Capitalized the default export for IDE autoimport improvement
- Fixed various return types to remove unattainable `undefined` results

# Notes

This package is mainly a porting of https://www.leppsoft.com/soundpad/files/rc/SoundpadRemoteControl.java to Typescript, with some utility functions added.
