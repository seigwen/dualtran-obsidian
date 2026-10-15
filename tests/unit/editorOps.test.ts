import { describe, expect, it } from "vitest";
import { insertBelowSelection, replaceSelectionWith } from "../../src/editorOps";

class FakeEditor {
  replacedWith: string | null = null;
  ranges: Array<{ text: string; from: any; to: any }> = [];
  constructor(
    public selection = "hola",
    public cursorEnd = { line: 3, ch: 2 },
    public lineText = "0123456789"
  ) {}
  getSelection() {
    return this.selection;
  }
  replaceSelection(t: string) {
    this.replacedWith = t;
  }
  getCursor() {
    return this.cursorEnd;
  }
  getLine() {
    return this.lineText;
  }
  replaceRange(text: string, from: any, to: any) {
    this.ranges.push({ text, from, to });
  }
}

describe("replaceSelectionWith", () => {
  it("writes the translation over the selection", () => {
    const editor = new FakeEditor("hola");
    expect(replaceSelectionWith(editor as any, "hello")).toBe(true);
    expect(editor.replacedWith).toBe("hello");
  });

  it("is a no-op for empty translations", () => {
    const editor = new FakeEditor("hola");
    expect(replaceSelectionWith(editor as any, "")).toBe(false);
    expect(editor.replacedWith).toBeNull();
  });
});

describe("insertBelowSelection", () => {
  it("inserts a blank line plus the translation at the end of the selection line", () => {
    const editor = new FakeEditor("hola", { line: 3, ch: 2 }, "0123456789");
    expect(insertBelowSelection(editor as any, "hello")).toBe(true);
    expect(editor.ranges).toHaveLength(1);
    const { text, from, to } = editor.ranges[0];
    expect(text).toBe("\n\nhello");
    expect(from).toEqual({ line: 3, ch: 10 });
    expect(to).toEqual({ line: 3, ch: 10 });
  });

  it("falls back to the selection end when the editor has no getLine", () => {
    const calls: any[] = [];
    const editor: any = {
      getSelection: () => "hola",
      replaceSelection: () => {},
      getCursor: () => ({ line: 1, ch: 4 }),
      replaceRange: (...args: any[]) => {
        calls.push(args);
      },
    };
    expect(insertBelowSelection(editor, "hello")).toBe(true);
    expect(calls[0][1]).toEqual({ line: 1, ch: 4 });
    expect(calls[0][2]).toEqual({ line: 1, ch: 4 });
  });

  it("is a no-op for empty translations", () => {
    const editor = new FakeEditor();
    expect(insertBelowSelection(editor as any, "")).toBe(false);
    expect(editor.ranges).toHaveLength(0);
  });
});
