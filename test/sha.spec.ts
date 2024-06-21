import * as path from 'path';

import { sha } from '../src/sha';

describe('sha', () => {
  it('should correctly hash a file', async () => {
    expect(await sha(path.resolve(__dirname, 'fixtures', 'tohash'))).toEqual(
      '12998c017066eb0d2a70b94e6ed3192985855ce390f321bbdb832022888bd251',
    );
  });
});
