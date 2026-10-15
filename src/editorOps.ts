/**
 * Pure editor-insertion helpers. The editor parameter only needs the Obsidian
 * Editor surface used here, so tests drive it with a fake object.
 */
export interface EditorLike {
  getSelection(): string;
  replaceSelection(text: string): void;
  getCursor(which?: "from" | "to"): { line: number; ch: number };
  getLine?(line: number): string;
  replaceRange(text: string, from: { line: number; ch: number }, to?: { line: number; ch: number }): void;
}

/** Replace the current selection with the translation. Returns false on empty input. */
export function replaceSelectionWith(editor: EditorLike, translated: string): boolean {
  if (!translated) {
    return false;
  }
  editor.replaceSelection(translated);
  return true;
}

/**
 * Keep the original selection and insert the translation below it: a blank
 * line plus the text, placed at the end of the selection's last line.
 */
export function insertBelowSelection(editor: EditorLike, translated: string): boolean {
  if (!translated) {
    return false;
  }
  const to = editor.getCursor("to");
  const lineText = typeof editor.getLine === "function" ? editor.getLine(to.line) : null;
  const position = { line: to.line, ch: lineText != null ? lineText.length : to.ch };
  editor.replaceRange(`\n\n${translated}`, position, position);
  return true;
}
