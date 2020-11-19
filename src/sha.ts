import * as fs from 'fs-extra';
import * as crypto from 'crypto';

export const sha = async (filePath: string) => {
  const hash = crypto.createHash('sha256');
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(hash);
  await new Promise((resolve, reject) => {
    fileStream.on('end', () => resolve());
    fileStream.on('error', (err) => reject(err));
  });
  return hash.digest('hex');
};
