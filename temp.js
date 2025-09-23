import Soundpad from './lib/index.js';

const soundpad = new Soundpad.default();

await soundpad.connect();

soundpad.getSoundListJSON().then(sounds => {
  sounds.some(sound => {
    return !sound.tag
  })
  console.log(sounds);
});