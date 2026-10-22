# Privacy mode

The user can hide their name, phone, email, photo and other fields. Reads through LuliCV's CLI or MCP then return placeholders; the real values stay on this machine and are filled in only in a PDF the user approves in the web page. Work as usual on everything else. The mode covers reads through LuliCV only: it does not stop an agent that has other access to the user's files, and it does not cover what an agent read before it was on. A user who wants it should turn it on first and type the details in 隐私信息, or remove them from an old file before an agent reads it.

## Recognize it

Every response carries `privacy: {mode, fields, notice}` while it is on, `lulicv doctor` adds a `privacy` check, and `lulicv privacy` prints the settings. Follow the `notice`.

## Placeholders

Hidden values read as `{{private:phone}}`, `{{private:name}}`, or `{{private:link:<id>}}` for a link.

- Keep, move, copy or delete them like any text; each copy exports as the real value.
- Do not try to work out the real value, and do not ask the user for it to write into the resume.
- A private field the user has not filled yet takes what you write, and the response says it was moved into the private values. A field that already has a value rejects a different one: ask the user to re-enter it in the web page (隐私模式 in the editor toolbar → 重新填写).

## Never go around it

The Bridge only hides what passes through it, so while privacy mode is on:

- Do not open, copy or query the workspace's own files: `lulicv.db` (and `-wal`, `-shm`), anything under `.lulicv/`, and backups. No `sqlite3`, no reading token files.
- Do not read exported PDFs (no `pdftotext`, no opening or screenshotting them). The web page holds only placeholders, so you may look at or screenshot the editor and its preview, except while the user is typing a private value (an open 填写 field shows what they type once they click 显示). For page images use `lulicv inspect --images <dir>`: pages are rendered with the real values, so the page count is real, and each hidden value is covered by its field name.
- Do not click buttons in the web page for the user. Approving an export, re-entering values and turning privacy mode off are the user's decisions, even though you could reach them in a browser.
- Reach the Bridge only through `lulicv` and the MCP tools. Do not call its HTTP API yourself (`curl`, `fetch`) and open the editor `url` only in the browser the user is watching: it signs that browser in as the user.

`backup` and turning privacy mode off are refused for agents (`PRIVACY_MODE`); tell the user to do them in the web page.

## Turn it on

Only when the user asks: `lulicv privacy on` (default fields: name, phone, email, photo, birthDate, hometown, politicalStatus) or `lulicv privacy on --fields name,phone,email,photo,birthDate,hometown,politicalStatus,location,links`. Running it again with more fields hides more. If a field has different values in different resumes, nothing changes and the error says so; the user turns it on in the web page and picks the value to export with. Showing a field again or turning the mode off happens only in the web page.

## Export

Export the revision you inspected; the user approves it in the web page.

- CLI: `lulicv export <id> --revision <N>`, no `--output`. It waits up to five minutes while the user decides, printing progress on stderr, and returns `{id, revision, pages, delivered: "browser"}`.
- MCP: `export_resume_pdf({id, revision})`. It waits up to 50 seconds; if the user has not decided it returns `{status: "pending", requestId}`, so call it again with the same id, revision and that `requestId`.

Tell the user to approve the request in the web page. With `webOpen: false` no editor page is open: run `lulicv preview` to open one, as in Start a session in SKILL.md. Once approved, the PDF is handed to the user's browser to download; you never get the file or its path. Report the page count and ask the user to check the download: if they cancelled the browser's save dialog nothing was saved, and you can request the same revision again.

- `EXPORT_DECLINED`: the user declined or the request ran out of time. Do not retry on your own or look for another way to export; ask whether they still want it or want changes first.
- `EXPORT_PENDING`: another request is waiting. Let the user deal with it; do not send more.
- If the resume was saved after the request, the web page cannot approve it and tells the user to decline. Get the new revision, inspect it again, and request that one.
