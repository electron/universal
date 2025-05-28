import fs from 'node:fs';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import { d } from './debug.js';

export const sha = async (filePath: string) => {
  d('hashing', filePath);
  const hash = crypto.createHash('sha256');
  hash.setEncoding('hex');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.read();
};
