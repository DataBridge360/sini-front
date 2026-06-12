"use client";

import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  Trash2,
  Underline,
  Undo2
} from "lucide-react";
import type { ReactNode } from "react";

// Editor de descripción estilo Notion: títulos, listas, checklists, tablas y
// atajos de markdown ("# ", "- ", "[] ", etc.) que ya trae StarterKit.
export function TaskEditor({
  value,
  placeholder,
  editable = true,
  minHeightClass = "min-h-[180px]",
  onChange
}: {
  value: unknown;
  placeholder?: string;
  editable?: boolean;
  minHeightClass?: string;
  onChange?: (json: JSONContent) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false }
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: placeholder ?? "Escribí la descripción..." })
    ],
    content: (value as JSONContent | null) ?? null,
    editable,
    // Evita el mismatch de hidratación de Next: el editor se monta en el cliente.
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => {
      onChange?.(current.getJSON());
    }
  });

  if (!editable) {
    return (
      <div className="sp-rich-text is-readonly">
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    <div className="sp-rich-text rounded-xl border border-slate-200 bg-white focus-within:border-[color:var(--org-primary)]">
      {editor ? <EditorToolbar editor={editor} /> : null}
      <div className={`${minHeightClass} cursor-text px-3 py-2`} onClick={() => editor?.chain().focus().run()}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function EditorToolbar({ editor }: { editor: Editor }) {
  // En TipTap v3 los componentes no se rerenderizan por transacción: los estados
  // activos se leen con useEditorState.
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      h1: current.isActive("heading", { level: 1 }),
      h2: current.isActive("heading", { level: 2 }),
      h3: current.isActive("heading", { level: 3 }),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      taskList: current.isActive("taskList"),
      blockquote: current.isActive("blockquote"),
      table: current.isActive("table"),
      canUndo: current.can().undo(),
      canRedo: current.can().redo()
    })
  });

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 px-2 py-1.5">
      <ToolbarButton
        label="Título 1"
        isActive={state?.h1}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Título 2"
        isActive={state?.h2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Título 3"
        isActive={state?.h3}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={15} />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton label="Negrita" isActive={state?.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={15} />
      </ToolbarButton>
      <ToolbarButton label="Cursiva" isActive={state?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Subrayado"
        isActive={state?.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline size={15} />
      </ToolbarButton>
      <ToolbarButton label="Tachado" isActive={state?.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={15} />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton label="Lista" isActive={state?.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Lista numerada"
        isActive={state?.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Checklist"
        isActive={state?.taskList}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListChecks size={15} />
      </ToolbarButton>
      <ToolbarButton label="Cita" isActive={state?.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={15} />
      </ToolbarButton>
      <ToolbarDivider />
      {state?.table ? (
        <>
          <ToolbarButton label="Agregar fila" onClick={() => editor.chain().focus().addRowAfter().run()}>
            <span className="px-0.5 text-[10px] font-bold">+Fila</span>
          </ToolbarButton>
          <ToolbarButton label="Agregar columna" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            <span className="px-0.5 text-[10px] font-bold">+Col</span>
          </ToolbarButton>
          <ToolbarButton label="Borrar fila" onClick={() => editor.chain().focus().deleteRow().run()}>
            <span className="px-0.5 text-[10px] font-bold">-Fila</span>
          </ToolbarButton>
          <ToolbarButton label="Borrar columna" onClick={() => editor.chain().focus().deleteColumn().run()}>
            <span className="px-0.5 text-[10px] font-bold">-Col</span>
          </ToolbarButton>
          <ToolbarButton label="Eliminar tabla" onClick={() => editor.chain().focus().deleteTable().run()}>
            <Trash2 size={15} />
          </ToolbarButton>
        </>
      ) : (
        <ToolbarButton
          label="Insertar tabla"
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <Table size={15} />
        </ToolbarButton>
      )}
      <ToolbarDivider />
      <ToolbarButton label="Deshacer" disabled={!state?.canUndo} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={15} />
      </ToolbarButton>
      <ToolbarButton label="Rehacer" disabled={!state?.canRedo} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={15} />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  label,
  isActive,
  disabled,
  onClick,
  children
}: {
  label: string;
  isActive?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        isActive
          ? "bg-[color:var(--org-primary-soft)] text-[color:var(--org-primary)]"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      }`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-4 w-px bg-slate-200" />;
}
