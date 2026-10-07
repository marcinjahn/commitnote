export interface DataSecurityActions {
  readonly exporting: boolean;
  readonly exportDisabled: boolean;
  readonly onExport: () => void;
  readonly importing: boolean;
  readonly importDisabled: boolean;
  readonly onImportFile: (file: File) => void;
  readonly changePassphraseDisabled: boolean;
  readonly onChangePassphrase: () => void;
}
