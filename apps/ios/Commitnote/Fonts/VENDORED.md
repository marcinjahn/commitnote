# Vendored note fonts

The 10 note font families, as full upstream TTFs. The iOS app bundles them through `UIAppFonts` in
`project.yml`, and the Linux app installs them from here (`apps/linux/data/meson.build`). Every
family is under the SIL Open Font License 1.1; the licence texts are in `Licenses/`.

Variable fonts were renamed from `Name[axes].ttf` to `Name-Variable.ttf` and `Name-Italic[axes].ttf`
to `Name-VariableItalic.ttf`; the contents are unmodified.

| Family | Files | Source commit | Licence |
| --- | --- | --- | --- |
| Inter | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| IBM Plex Sans | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| Atkinson Hyperlegible Next | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| Nunito | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| iA Writer Quattro | static Regular, Bold, Italic, BoldItalic | iaolo/iA-Fonts `c6588670c71e9ac628acc27b72cde4bf12726b7f` | OFL 1.1 |
| Literata | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| Source Serif 4 | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| Lora | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| JetBrains Mono | variable roman and italic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |
| IBM Plex Mono | static Regular, SemiBold, Italic, SemiBoldItalic | google/fonts `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` | OFL 1.1 |

| File | Source URL | SHA-256 |
| --- | --- | --- |
| `Inter-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/inter/Inter[opsz,wght].ttf | `29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031` |
| `Inter-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/inter/Inter-Italic[opsz,wght].ttf | `acd98e64795781b2058f07b18475e0ecee2a0fe2b42a49e2f9e37d0d6bf66ce6` |
| `Licenses/Inter-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/inter/OFL.txt | `5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57` |
| `IBMPlexSans-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf | `3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3` |
| `IBMPlexSans-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexsans/IBMPlexSans-Italic[wdth,wght].ttf | `0b94c5e981993764db32bf9c610ecc60cbd34ad77ec2f10ba03c64ab75124d8e` |
| `Licenses/IBMPlexSans-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexsans/OFL.txt | `7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da` |
| `AtkinsonHyperlegibleNext-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext[wght].ttf | `5a455d1cfa099b601ab70751bb9673e8fe1854dc4500c80e1a220d0d75e31745` |
| `AtkinsonHyperlegibleNext-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext-Italic[wght].ttf | `ce9cffed32742ad2d9238c561a93220385e5934cdc02b8eb4097a50efa957dc6` |
| `Licenses/AtkinsonHyperlegibleNext-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/atkinsonhyperlegiblenext/OFL.txt | `aca6a428580965d2297d1b718042dd427c2a9443ece3b0d02d758e161e0c4030` |
| `Nunito-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/nunito/Nunito[wght].ttf | `bb55a5ca5c2042335b3991af27c4d0705d0ef41cac6164ac737fd8f2a1e85207` |
| `Nunito-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/nunito/Nunito-Italic[wght].ttf | `b520cc871868b0acfca1beda875df7f4a44ebce914f8a89f83977fc9c09529c8` |
| `Licenses/Nunito-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/nunito/OFL.txt | `580df76c95a1ec5ab878ceb25bb3d85c6a076804e9c970c8c6972aea775fdf65` |
| `Literata-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/literata/Literata[opsz,wght].ttf | `b41138c9373112f32abb589cc22e8674b06ed4048b0c513be922bdd26f274440` |
| `Literata-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/literata/Literata-Italic[opsz,wght].ttf | `d483dfaeba9cbf4ce71d32a52ee65df82f7e35b15fff8d1011cdb242d1fcd465` |
| `Licenses/Literata-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/literata/OFL.txt | `8742963604cd89dc81437811a850018fc03b2bfad686d7422c8235967c87614e` |
| `SourceSerif4-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/sourceserif4/SourceSerif4[opsz,wght].ttf | `97b2d4da6e3cb494b5a1e66ae176914d852ccabef49e0c02c0df25f3e39aca0b` |
| `SourceSerif4-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/sourceserif4/SourceSerif4-Italic[opsz,wght].ttf | `15fbc7e4679489a501998c3669272637a6646388ef7e4bd77eebb5bf967a1f42` |
| `Licenses/SourceSerif4-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/sourceserif4/OFL.txt | `5f94c3fd3a23131a417ab5a0c8452de57e70c3cfb9f604d88241f7065ebf9fd9` |
| `Lora-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/lora/Lora[wght].ttf | `822a6621ccbe8d97d20ac88c1c41f5615c9c2c202eaa75f272cd452aac6475a7` |
| `Lora-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/lora/Lora-Italic[wght].ttf | `22d8d8854b53807aa664ca34f2031a9ed57a1d0dea296b8b96cdd3aad937a2b3` |
| `Licenses/Lora-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/lora/OFL.txt | `1d9a970809ac804b582a6ce7f0ebc4e7fefcbfd7ff6299cad35ee656a21be716` |
| `JetBrainsMono-Variable.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/jetbrainsmono/JetBrainsMono[wght].ttf | `48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda` |
| `JetBrainsMono-VariableItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/jetbrainsmono/JetBrainsMono-Italic[wght].ttf | `85ae2a5cd3f56baf1ce1c21a851322c58e3d8fbe8e8ad4a4d090a820dd7fe558` |
| `Licenses/JetBrainsMono-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/jetbrainsmono/OFL.txt | `b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d` |
| `IBMPlexMono-Regular.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexmono/IBMPlexMono-Regular.ttf | `6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46` |
| `IBMPlexMono-SemiBold.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf | `d3c38e55c78f5b0f28009fddba4834ec503278936a5986032424c9bd2d23aa46` |
| `IBMPlexMono-Italic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexmono/IBMPlexMono-Italic.ttf | `3362fc791b0652193328b862c1c5f23a789bc7288b1617fa63302f88689a2a34` |
| `IBMPlexMono-SemiBoldItalic.ttf` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexmono/IBMPlexMono-SemiBoldItalic.ttf | `391ef0e273eb52571eccaab6a6dbddeec48e1d282cb7bf153043512b797ed6f0` |
| `Licenses/IBMPlexMono-OFL.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/ibmplexmono/OFL.txt | `7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da` |
| `iAWriterQuattroS-Regular.ttf` | https://raw.githubusercontent.com/iaolo/iA-Fonts/c6588670c71e9ac628acc27b72cde4bf12726b7f/iA%20Writer%20Quattro/Static/iAWriterQuattroS-Regular.ttf | `6e367e0e00e057d383680ffae7b64f520d06e1f96abd28bddd67d424fee8e8df` |
| `iAWriterQuattroS-Bold.ttf` | https://raw.githubusercontent.com/iaolo/iA-Fonts/c6588670c71e9ac628acc27b72cde4bf12726b7f/iA%20Writer%20Quattro/Static/iAWriterQuattroS-Bold.ttf | `40dbb1ffed472cdc96a0133073bc777a40782883678b80dfd31677d5963b72b9` |
| `iAWriterQuattroS-Italic.ttf` | https://raw.githubusercontent.com/iaolo/iA-Fonts/c6588670c71e9ac628acc27b72cde4bf12726b7f/iA%20Writer%20Quattro/Static/iAWriterQuattroS-Italic.ttf | `84c19517be57e8c0521f43a1d5c29766b1f0cb9353300e819b193da1b02f47ac` |
| `iAWriterQuattroS-BoldItalic.ttf` | https://raw.githubusercontent.com/iaolo/iA-Fonts/c6588670c71e9ac628acc27b72cde4bf12726b7f/iA%20Writer%20Quattro/Static/iAWriterQuattroS-BoldItalic.ttf | `f61aa3c97d611dec01c7414e07b9212a164501b6d1a800af0dcda11acf4eabb0` |
| `Licenses/iAWriterQuattro-LICENSE.md` | https://raw.githubusercontent.com/iaolo/iA-Fonts/c6588670c71e9ac628acc27b72cde4bf12726b7f/iA%20Writer%20Quattro/LICENSE.md | `2eb84d6d03a9af6e99816f82f50a77c26e7ff6681293f4619cd33a392a8c13b6` |
