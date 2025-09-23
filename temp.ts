import Soundpad from '.';

const soundpad = new Soundpad();

await soundpad.connect();

soundpad.getSoundListJSON().then(sounds => {
  sounds.some(sound => {
    return !sound.tag
  })
  console.log(sounds);
});