# Third-party fonts

## LXGW Neo XiHei / 霞鹜新晰黑

- Version: 1.305
- File: `LXGWNeoXiHei-v1.305.ttf`
- Source: https://github.com/lxgw/LxgwNeoXiHei/releases/tag/v1.305
- SHA-256: `893cfbec604768f03785ab4f369508de68c274273359a5cadee17e2852975d5c`
- License: IPA Font License 1.0
- License text: https://github.com/lxgw/LxgwNeoXiHei/blob/main/LICENSE.md

## Noto Sans SC / 思源黑体

- Package: `@fontsource/noto-sans-sc` (version as locked in `package-lock.json`), simplified Chinese subsets, weights 400, 500 and 700
- Source: https://fontsource.org/fonts/noto-sans-sc
- License: SIL Open Font License 1.1
- License text: shipped as `licenses/NotoSansSC-LICENSE`
- The "栗" in `public/favicon.svg` is an outline of Noto Sans SC SemiBold (600).

## MiSans

- Package: `misans` (version as locked in `package-lock.json`), the variable font in the subsets Xiaomi's own font service uses
- Source: https://github.com/dsrkafuu/misans
- The font files are shipped unmodified, as the package provides them.
- License: the font is Xiaomi's and is used under the MiSans 字体知识产权许可协议 (MiSans Font IP License Agreement).
  This software uses the MiSans font.
- License text: shipped as `licenses/MiSans-FONT-LICENSE.pdf`, the agreement as Xiaomi publishes it at
  https://hyperos.mi.com/font-download/MiSans%E5%AD%97%E4%BD%93%E7%9F%A5%E8%AF%86%E4%BA%A7%E6%9D%83%E8%AE%B8%E5%8F%AF%E5%8D%8F%E8%AE%AE.pdf
  (SHA-256 `4a93a27cd2bd81b3b5ecfd0a853144a876fa26938a93a68443c67d74172fcb86`)
- `licenses/MiSans-package-LICENSE` is the Apache License 2.0 of the `misans` package's scripts, not the font license.

## Fraunces

- Not bundled as a font. The LuliCV wordmark (`src/studio/brand.tsx`) is an outline of Fraunces Italic.
- Source: https://github.com/undercasetype/Fraunces
- License: SIL Open Font License 1.1

All fonts are bundled locally and are never requested from a CDN at runtime.
