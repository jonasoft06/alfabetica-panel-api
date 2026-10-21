import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L: a client reads this code aloud or types it from paper.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const GROUP_LENGTH = 4;

function randomGroup(): string {
  let group = '';
  for (let i = 0; i < GROUP_LENGTH; i += 1) {
    // randomInt is uniform, unlike Math.random() or a modulo over bytes.
    group += ALPHABET[randomInt(ALPHABET.length)];
  }
  return group;
}

// XXXX-XXXX. Uniqueness is checked by the caller.
export function generatePublicCode(): string {
  return `${randomGroup()}-${randomGroup()}`;
}
