const COMMON_PASSWORDS = [
  'password1234',
  'password12345',
  'passwordpassword',
  'administrator1',
  'qwertyuiop12',
  'qwertyuiop123',
  '123456789012',
  '1234567890123',
  '111111111111',
  '000000000000',
  'iloveyou1234',
  'letmeinplease',
  'welcome12345',
  'changeme1234',
  'adminadmin12',
  'passw0rd1234',
  'abc123456789',
  'trustno1abcd',
] as const;

const COMMON = new Set<string>(COMMON_PASSWORDS);

export function isCommonPassword(password: string): boolean {
  return COMMON.has(password.toLowerCase());
}
