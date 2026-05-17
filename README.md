# Tiptap Structured Document Editor

A Tiptap-based rich-text editor enforcing a structured document model:

```
Document
 └── Section (id)
      ├── Heading
      └── Clause (id, tags[])
           └── Block content (paragraph, lists, blockquote, etc.)
```

## Schema rules

- **Document** must contain one or more sections.
- **Section** is a root-only node (cannot nest in another section or clause). Each section has a user-provided `id` and starts with a heading followed by zero or more clauses.
- **Clause** carries an auto-generated `id` and a `tags: string[]` metadata array. Clauses hold block content (paragraphs, lists, etc.).

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```
