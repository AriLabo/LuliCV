# Resume tree and tailoring

`lulicv tree` returns the whole workspace in a few hundred characters:

- `kind: "base"`: the full master and role directions such as "后端方向", each with an optional one-line `purpose`.
- `kind: "job"`: a version for one application, with `target` company/role.
- `sourceChanges`: how many content changes in the resume it was copied from have not been carried over yet.

The tree is organisation only. A child is an independent copy and inherits nothing from its parent. At most three levels; job versions are always leaves.

## Tailoring to a JD

1. If a job version for that company and role already exists, reuse it.
2. Otherwise pick the parent by matching the JD against each base resume's name and `purpose`. If two fit, ask the user. If none fits, propose a new direction under the master (duplicate it, then add `/purpose`, e.g. "投数据开发岗位，突出实时数仓") and confirm before creating it.
3. `lulicv duplicate <base-id> --revision <N> --mutation-id <ID> --name "<公司> · <岗位>" --parent <base-id> --quiet` (MCP: `duplicate_resume` with `sourceRevision` and `parentId`).
4. Record the job with this operation in the first patch of the job version: `{"op": "add", "path": "/target", "value": {"company": "...", "role": "...", "jd": "<JD text>"}}`. In later sessions read `/target/jd` instead of asking again; `lulicv get <id> --quiet` omits it when you do not need it.
5. Unless the user asks, edit the job version, not the master or a direction.

Review a tailored version with `lulicv diff <job-id> --against <base-id>`: what this version changed relative to its base, as readable labels plus JSON Pointers.

## Keeping copies current

When `sourceChanges` is present, `lulicv diff <id> --source` lists what changed in the source since the copy. Tell the user and port only what they approve with a normal patch. Identity fields (name, phone, email, links) almost always should be ported; tailored wording usually should not. A ported change stops counting automatically. If the user declines the rest, mark them as seen with `{"op": "replace", "path": "/source/revision", "value": <toRevision from diff>}`; the source's later changes are flagged again.

## Placement and status

- Move with a patch on `/parentId` (remove it for the top level); describe a base resume with `/purpose`. The Bridge rejects cycles, a job version as parent and a fourth level.
- `lulicv history <id>` lists recent revisions with who made them (`human`, `agent`, …) and readable changes; `lulicv diff <id> --from <N> [--to <M>]` compares two revisions; `lulicv get <id> --revision <N>` reads one, for example to recover wording; `lulicv restore <id> --to <N> --revision <latest>` makes it the newest version again.
