import idle from '../assets/idle.webm'
import thinking from '../assets/thinking.webm'
import writing from '../assets/writing.webm'
import complete from '../assets/complete.webm'
import interact from '../assets/interact.webm'
import waiting from '../assets/waiting.webm'
import rest from '../assets/rest.webm'
import enter from '../assets/writing-enter.webm'
import loop from '../assets/writing-loop.webm'
import exit from '../assets/writing-exit.webm'
import poster from '../assets/poster.png'
export { poster }
export const clips = { idle, thinking, writing, complete, interact, waiting, rest, 'writing-enter': enter, 'writing-loop': loop, 'writing-exit': exit }
export type Clip = keyof typeof clips
