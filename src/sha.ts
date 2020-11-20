import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import { d } from './debug';

export const sha = async (filePath: string) => {
  d('hashing', filePath);
  const hash = crypto.createHash('sha256');
  hash.setEncoding('hex');
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(hash);
  await new Promise((resolve, reject) => {
    fileStream.on('end', () => resolve());
    fileStream.on('error', (err) => reject(err));
  });
  return hash.read();
};
