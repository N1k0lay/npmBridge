export function extractTarballVersion(filename, packageName) {
  const tarballName = filename.endsWith('.tgz') ? filename.slice(0, -4) : filename;
  const baseName = packageName.split('/').pop();
  const prefix = `${baseName}-`;

  if (baseName && tarballName.startsWith(prefix)) {
    return tarballName.slice(prefix.length) || 'unknown';
  }

  const versionMatch = filename.match(/(\d+\.\d+\.\d+(?:-[^/]+)?)\.tgz$/);
  return versionMatch ? versionMatch[1] : 'unknown';
}
