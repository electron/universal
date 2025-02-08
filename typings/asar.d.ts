declare module '@electron/asar/lib/disk' {
  type ArchiveHeader = {
    // The JSON parsed header string
    header: any; // DirectoryRecord
    headerString: string;
    headerSize: number;
  };

  function readArchiveHeaderSync(archivePath: string): ArchiveHeader;
}
