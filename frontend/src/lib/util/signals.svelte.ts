let _folderSignal = $state(0);

export function bumpFolders() {
  _folderSignal++;
}

export function folderSignal() {
  return _folderSignal;
}
