# Stopping, backups and recovery

For any failure, start with `lulicv doctor`. It checks the runtime, the browser, the lock and the Bridge without opening resumes or printing tokens; follow the `nextAction` of each failing check.

- **Stopping:** `lulicv stop` waits for rendering in progress, then cleans up. If it times out, the error names the process still running: report it rather than killing it, since a forced kill can interrupt a write.
- **The Bridge cannot read its own files** (doctor `bridge-files` error, or inspect and export report 「无法读取安装文件」): some agent sandboxes take file access away from a background process once the shell that started it ends. The editor keeps working; run `lulicv stop` from the current session, and the next command starts a fresh Bridge.
- **Stale lock** (doctor `lock` warning naming an exited process): the next command that starts the Bridge clears it (`lulicv preview` reports it as `recoveredStaleLock`). `lulicv unlock` does the same and refuses while that process is alive. One workspace has one Bridge; never start a second next to a live one.
- **Recovery marker or integrity failure:** after an unexpected exit, startup refuses to continue. Report it and leave the workspace as it is; removing the marker or touching database files can lose the user's data.
- **Backup and restore,** only when the user asks, in this order:

```sh
lulicv backup --output "<new-backup.db>"
lulicv stop
lulicv restore-workspace --file "<backup.db>"
lulicv preview
```

Restore checks the backup's integrity and keeps a copy of what it replaces.

## Where the workspace is

`lulicv workspace` shows the directory and whether it is the default one in the user's data directory or one the user chose. Change it only when the user asks, and keep it on a local disk: a folder synced by iCloud, OneDrive or a network drive can corrupt the database.

- **Start over somewhere else:** `lulicv stop`, then `lulicv workspace "<new or empty directory>"`, then `lulicv preview`. The resumes stay in the old workspace.
- **Move the resumes:** `lulicv stop`, move the whole workspace directory to its new place, then `lulicv workspace "<new location>"`. A backup cannot be restored into another workspace, so copying the directory is the way to move.
- **Chosen workspace not found:** it may have been moved or be on a disk that is not connected. Ask the user before choosing another.
