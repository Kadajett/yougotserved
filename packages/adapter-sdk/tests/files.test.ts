import { describe, expect, it } from 'vitest';
import {
  basename,
  classifyUploadPath,
  extensionOf,
  normaliseFileRef,
  normalisePath,
  UploadError,
} from '../src/files.js';

describe('path helpers', () => {
  it('folds Windows separators', () => {
    expect(normalisePath('C:\\Users\\ada\\resume.pdf')).toBe('C:/Users/ada/resume.pdf');
    expect(basename('C:\\Users\\ada\\resume.pdf')).toBe('resume.pdf');
    expect(extensionOf('/home/ada/Resume.PDF')).toBe('pdf');
  });

  it('treats a leading dot as part of the name, not an extension', () => {
    expect(extensionOf('/home/ada/.env')).toBe('');
  });
});

describe('classifyUploadPath', () => {
  const roots = ['/home/ada/Documents'];

  it('allows a plain file under a configured root', () => {
    expect(classifyUploadPath('/home/ada/Documents/resume.pdf', { allowedRoots: roots })).toEqual({
      decision: 'allow',
      path: '/home/ada/Documents/resume.pdf',
    });
  });

  it('asks before touching anything outside the roots', () => {
    const verdict = classifyUploadPath('/home/ada/Downloads/resume.pdf', { allowedRoots: roots });
    expect(verdict.decision).toBe('confirm');
  });

  it('asks for everything when no roots are configured', () => {
    expect(classifyUploadPath('/home/ada/Documents/resume.pdf').decision).toBe('confirm');
  });

  it.each([
    ['/home/ada/.ssh/id_ed25519', 'SSH keys'],
    ['/home/ada/.aws/credentials', 'AWS credentials'],
    ['/home/ada/project/.env', 'environment file'],
    ['/home/ada/project/.env.production', 'environment file'],
    ['/home/ada/.config/gcloud/credentials.db', 'gcloud credentials'],
    ['/home/ada/.git-credentials', 'git credentials'],
    ['/etc/shadow', 'system account files'],
    ['/home/ada/.config/google-chrome/Default/Cookies', 'Chrome profile (Linux)'],
    [
      '/Users/ada/Library/Application Support/Google/Chrome/Default/Cookies',
      'Chrome profile (macOS)',
    ],
    ['/home/ada/.mozilla/firefox/abc.default/logins.json', 'Firefox profile'],
    ['/home/ada/.config/chromium/Default/Login Data', 'Chromium profile'],
    ['C:\\Users\\ada\\AppData\\Roaming\\thing.dat', 'Windows application data'],
    ['/Users/ada/Library/Keychains/login.keychain-db', 'macOS keychain'],
  ])('refuses %s outright', (path) => {
    const verdict = classifyUploadPath(path, { allowedRoots: ['/'] });
    expect(verdict.decision).toBe('deny');
  });

  it('refuses key material by extension even inside an allowed root', () => {
    const verdict = classifyUploadPath('/home/ada/Documents/server.pem', { allowedRoots: roots });
    expect(verdict).toMatchObject({
      decision: 'deny',
      reason: expect.stringMatching(/private key/),
    });
  });

  it('refuses a relative path rather than guessing a working directory', () => {
    expect(classifyUploadPath('resume.pdf').decision).toBe('deny');
    expect(classifyUploadPath('./resume.pdf').decision).toBe('deny');
  });

  it('refuses traversal instead of resolving it', () => {
    const verdict = classifyUploadPath('/home/ada/Documents/../.ssh/id_rsa', {
      allowedRoots: roots,
    });
    expect(verdict).toMatchObject({ decision: 'deny', reason: expect.stringMatching(/\.\./) });
  });

  it('does not let a sibling directory pass as a root', () => {
    const verdict = classifyUploadPath('/home/ada/Documents-secret/x.pdf', {
      allowedRoots: roots,
    });
    expect(verdict.decision).toBe('confirm');
  });

  it('enforces an adapter extension allowlist', () => {
    const policy = { allowedRoots: roots, allowedExtensions: ['pdf', 'doc', 'docx'] };
    expect(classifyUploadPath('/home/ada/Documents/resume.pdf', policy).decision).toBe('allow');
    const rejected = classifyUploadPath('/home/ada/Documents/dump.sql', policy);
    expect(rejected).toMatchObject({ decision: 'deny', reason: expect.stringMatching(/pdf, doc/) });
  });

  it('is case-insensitive about sensitive locations', () => {
    expect(classifyUploadPath('/home/ada/.SSH/id_rsa', { allowedRoots: ['/'] }).decision).toBe(
      'deny',
    );
  });
});

describe('normaliseFileRef', () => {
  it('takes the filename from the path', () => {
    expect(normaliseFileRef({ path: '/home/ada/Documents/resume.pdf' })).toMatchObject({
      filename: 'resume.pdf',
    });
  });

  it('takes the filename from a URL path', () => {
    expect(normaliseFileRef({ url: 'https://example.test/files/cv.pdf?v=2' })).toMatchObject({
      filename: 'cv.pdf',
    });
  });

  it('requires exactly one source', () => {
    expect(() => normaliseFileRef({})).toThrow(/one of "path", "url", or "base64"/);
    expect(() => normaliseFileRef({ path: '/a/b.pdf', url: 'https://x.test/b.pdf' })).toThrow(
      /exactly one source/,
    );
  });

  it('requires a filename alongside inline content', () => {
    expect(() => normaliseFileRef({ base64: 'aGk=' })).toThrow(UploadError);
    expect(normaliseFileRef({ base64: 'aGk=', filename: 'note.txt' })).toMatchObject({
      filename: 'note.txt',
    });
  });

  it('refuses a filename that carries a path', () => {
    expect(() => normaliseFileRef({ base64: 'aGk=', filename: '../../etc/passwd' })).toThrow(
      /path separator/,
    );
  });

  it('ignores blank sources rather than treating them as set', () => {
    expect(normaliseFileRef({ path: '/a/b.pdf', url: '   ' })).toMatchObject({
      filename: 'b.pdf',
    });
  });
});
