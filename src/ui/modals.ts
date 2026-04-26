import { App, FuzzySuggestModal, Modal, TFile } from 'obsidian';

// ── ZidAssignModal ────────────────────────────────────────────────────────────

export class ZidAssignModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly newZid: string,
    private readonly onChoose: (file: TFile) => Promise<void>,
    placeholder?: string,
  ) {
    super(app);
    this.setPlaceholder(placeholder ?? `Asignar ${newZid} a...`);
  }

  getItems(): TFile[] { return this.files; }
  getItemText(file: TFile): string { return file.basename; }
  onChooseItem(file: TFile): void { void this.onChoose(file); }
}

// ── ConfirmModal ──────────────────────────────────────────────────────────────

export class ConfirmModal extends Modal {
  private resolve!: (value: boolean) => void;

  constructor(app: App, private readonly message: string) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.message });
    const btnRow = contentEl.createEl('div', { cls: 'confirm-modal-row' });
    const btnOk = btnRow.createEl('button', { text: 'OK', cls: 'mod-cta' });
    const btnCancel = btnRow.createEl('button', { text: 'Cancel' });
    btnOk.onclick = () => this.closeAndResolve(true);
    btnCancel.onclick = () => this.closeAndResolve(false);
  }

  onClose() { this.contentEl.empty(); }

  private closeAndResolve(val: boolean) {
    this.close();
    this.resolve(val);
  }

  openAndWait(): Promise<boolean> {
    this.open();
    return new Promise<boolean>((res) => { this.resolve = res; });
  }
}
