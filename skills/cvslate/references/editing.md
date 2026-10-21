# Editing and layout

## Patches

A patch (see the example in SKILL.md) applies RFC 6902 operations to `/name`, `/data/...`, `/appearance/...`, `/target`, `/parentId`, `/purpose`, `/sample` (remove it only when the user asks) or `/source/revision`. Change only the parts you mean to change: replacing `/data` or `/data/sections` as a whole is rejected, because it would overwrite whatever the user edited meanwhile. `--quiet` on `list`, `import`, `duplicate` and `patch` returns `{id, name, revision, …}` instead of the whole document.

## Page target and appearance

A page count is a target only when the user gives one; two pages are normal after several years of experience. Meeting one means wording and spacing first; cutting experience follows the rule in SKILL.md.

`cvslate themes` (MCP `list_themes`) lists each theme with its colour presets and settings, plus `layout`: the allowed range of each spacing value, the density presets, the fonts and per-section flags. Read it before adjusting; a value out of range is rejected with the range.

- **Theme:** `cvslate theme use <id> <theme-id>` does what the editor does: it applies the theme's first preset and keeps spacing, density, the photo switch and the resume's own stylesheet. Over MCP, write the same result in one patch: `/appearance/themeId`, the preset's id in `/appearance/preset`, a copy of its `settings` in `/appearance/settings`, and its `accentColor` and `fontFamily` in `/appearance/layout` (remove `fontFamily` when the preset has none).
- **Preset:** its `accentColor`, and its `fontFamily` if it has one, in `/appearance/layout`, and its id in `/appearance/preset`.
- **Theme settings** go in `/appearance/settings`, e.g. `{"header": "center"}`; only those the theme lists take effect.
- **Spacing** is document-wide, in `/appearance/layout`: `pageMarginMm`, `baseFontPt`, `lineHeight`, `sectionSpacingPt`, optional `fontFamily`. Rendering always uses these numbers; `/appearance/density` only records the preset the editor applied last, so change the numbers. Pagination already keeps headings with their content and never strands one bullet on a page. The only per-section control is `/data/sections/<i>/layout/pageBreakBefore`; use it sparingly.
- **Anything else** a theme's presets and settings do not offer: the resume's own stylesheet, below.

## The resume's own stylesheet

`/appearance/css` holds CSS for the skeleton classes and variables a theme uses ([making a theme](themes.md)). It applies to this resume's pages only, after the theme's rules, and stays when the theme changes. The limits of a theme's CSS apply (nothing loaded, at most 20 KB), and a stylesheet that breaks them is rejected; `cvslate validate` warns about unknown classes or variables and hard-coded colours. The editor only tells the user that the resume has one and lets them remove it; it does not show or edit the CSS. Remove it with `{"op": "remove", "path": "/appearance/css"}`.

How it meets the theme:

- It wins over a theme rule with the same selector. A theme rule tied to a setting (`&.rs-set-header-center .rs-name`) or an element (`a.rs-contact`) is more specific; repeat that part in yours to override it.
- Themes and their settings lay out the same parts differently: 标准 and 简约 put contacts in a wrapping row, 编辑 lists them in a column, and 标准's centred header centres them. A rule that relies on one layout can break another, so nest it under the theme and setting it was written for. To read what a theme does, `cvslate theme new <id> --from <theme> --output <directory>` copies its `theme.css` without installing anything.
- Each printable unit (section title, entry header, paragraph, bullet) sits in its own wrapper for pagination. Sibling selectors such as `.rs-bullet + .rs-bullet` therefore match nothing, and a rule reaches every element of its class. The wrappers' attributes (`data-block-id` and the like) are internal to pagination and change between versions, so a rule that targets them can stop working; the classes and variables in [making a theme](themes.md) are the supported surface.

For example, each link on its own line in 标准 with the left-aligned header (编辑 already lists one per line):

```css
&.rs-theme--standard:not(.rs-set-header-center) .rs-contact[data-kind="link"] { flex-shrink: 0; margin-right: 100%; }
```

Bullets further apart, in any theme: `.rs-bullet { padding-bottom: 4pt; }`. Look at the page images after each change.

## Checking the result

`cvslate patch … --inspect --max-pages <N> --images <directory>` lays out the revision it wrote. For an existing revision use `cvslate inspect <id> [--revision <N>] --max-pages <N> --images <directory>` (MCP `inspect_resume_layout`). The report names the revision it laid out, which is the one to export.

Read `layoutValid`, the page constraint and `pageFill` (the share of each page used), and look at the page images yourself. A last page under about 30% full usually means tightening spacing and wording to drop it, or loosening spacing to fill it, within the ranges `cvslate themes` gives. When only cutting content would meet the target, propose the cut rather than make it.

`cvslate validate <id>` lists problems, each with its place, the quoted text and the data path. They include Chinese typesetting conventions: clear mistakes (half-width punctuation between Chinese characters, full-width letters or digits, repeated punctuation) and mixed styles within one resume (brackets, quotation marks, date formats), where the majority style counts as the user's choice. Fix them in text you write or edit. In the user's own wording, list them and ask before changing anything.

Leave the spacing between Chinese and Latin text or digits as it is, neither adding nor removing spaces: pages add that gap on their own, and validate accepts both.
