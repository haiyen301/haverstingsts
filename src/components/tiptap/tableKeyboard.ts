import { findParentNode, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";

function isCellSelection(value: unknown): value is CellSelection {
  return value instanceof CellSelection;
}

function isAtCellContentStart(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      return $from.start(depth + 1) === $from.pos;
    }
  }
  return false;
}

function isActiveCellEmpty(editor: Editor): boolean {
  const cell = findParentNode(
    (node) => node.type.name === "tableCell" || node.type.name === "tableHeader",
  )(editor.state.selection);
  return cell ? cell.node.textContent.length === 0 : false;
}

function deleteTableWhenAllCellsSelected(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!isCellSelection(selection)) return false;

  let cellCount = 0;
  const table = findParentNode((node) => node.type.name === "table")(selection);
  table?.node.descendants((node) => {
    if (node.type.name === "table") return false;
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      cellCount += 1;
    }
    return undefined;
  });

  if (cellCount !== selection.ranges.length) return false;
  return editor.chain().focus().deleteTable().run();
}

/** Backspace deletes tables/cells progressively instead of requiring a full multi-cell selection. */
export function handleTableBackspace(editor: Editor): boolean {
  if (deleteTableWhenAllCellsSelected(editor)) return true;

  const { selection } = editor.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;

  const { $from } = selection;

  if ($from.parentOffset === 0) {
    const nodeBefore = $from.nodeBefore;
    if (nodeBefore?.type.name === "table") {
      return editor.chain().focus().deleteTable().run();
    }
  }

  if (!editor.isActive("table")) return false;
  if (!isAtCellContentStart(editor)) return false;

  if (!isActiveCellEmpty(editor)) return false;

  if (editor.commands.goToPreviousCell()) return true;

  if (editor.can().deleteTable()) {
    return editor.chain().focus().deleteTable().run();
  }

  if (editor.can().deleteRow()) {
    return editor.chain().focus().deleteRow().run();
  }

  return false;
}
