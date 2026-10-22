# Convert old material, then check it

1. Query current schema: CLI `lulicv schema` or MCP `get_resume_schema`; also `lulicv themes` if you set the appearance. Use the returned schema, not a copy from memory.
2. Use the host Agent's PDF/DOCX/text tools to extract the user's material. If those tools cannot read it reliably, request a readable document or text; do not pretend import succeeded. Preserve original content, numbers, dates and links. Text taken from a PDF keeps the original's line wraps, and a newline in a summary, description or bullet shows as a line break, so join wrapped lines back into their paragraph and keep only the breaks the original meant. Scan images need OCR supplied by the host Agent.
3. Build ONE ResumeData v1 JSON object: no workspace envelope, document id, revision or invented sample experiences. Follow the current required fields and section models. Unknown string fields can remain empty when Schema permits; list uncertain or missing facts separately in the conversation. Do not turn review comments into bullets.
4. Submit MCP `import_resume({mutationId, data, name?, appearance?})`, or save the pure data object in a temporary file and run:

```sh
lulicv import --file "<resume-data.json>" --mutation-id "<stable-import-id>" --name "原文待核对"
```

This creates a new document only. On an uncertain response, use exactly the same inputs and mutationId. Changing facts later is a patch/new request. An invalid structure commits nothing. Result `{document, warnings}` does not confirm factual correctness.

5. Show it in the editor and ask the user to compare to the original. Check name, phone/email, company, role, dates, projects, every bullet, numeric claims, links and omitted sections. Preserve uncertain items outside the formal resume until corrected.
6. After the review, tailor a copy as in [tree and tailoring](tree.md), and confirm the final revision with the user before export.
