import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { marked } from "marked";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

function mdToHtml(md: string): string {
  return marked.parse(md || "", { async: false }) as string;
}

export function MarkdownEditor(props: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
      Placeholder.configure({ placeholder: props.placeholder ?? "正文（Markdown / 富文本）" }),
    ],
    content: mdToHtml(props.value),
    onUpdate: ({ editor: ed }) => {
      props.onChange(turndown.turndown(ed.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = turndown.turndown(editor.getHTML());
    if (current.trim() !== props.value.trim()) {
      editor.commands.setContent(mdToHtml(props.value), false);
    }
  }, [props.value, editor]);

  return <EditorContent editor={editor} className="tiptap-host" />;
}
