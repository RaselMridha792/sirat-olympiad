# Fonts for the PDF renderer

Unmodified Noto fonts, embedded (as subsets) in the PDFs the worker renders: the admit card now, the certificates
next. The renderer is `src/modules/pdf/`. Each font is licensed under the SIL Open Font License 1.1; its licence text
sits next to it, and the OFL allows embedding the fonts in documents.

| File | Licence | Source |
| --- | --- | --- |
| NotoSansBengali-Regular.ttf | OFL-NotoSansBengali.txt | https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-Regular.ttf |
| NotoSansBengali-Bold.ttf | OFL-NotoSansBengali.txt | https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-Bold.ttf |
| NotoSans-Regular.ttf | OFL-NotoSans.txt | https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf |
| NotoSans-Bold.ttf | OFL-NotoSans.txt | https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf |

The licence texts come from https://github.com/notofonts/bengali (OFL.txt) and
https://github.com/notofonts/latin-greek-cyrillic (OFL.txt).

SHA-256, checked by `src/modules/pdf/pdf-assets.spec.ts` (a replaced font changes the layout, so it is a reviewed
change):

```
b55c62ee531e3214da6c0701daecea89a52ba42db7d8206b92e6b51f397a3193  NotoSansBengali-Regular.ttf
923c6a4c2eb618a57ed83f4bca855b4f5287b87906a4d9df40a2ffa8ebd8c2e8  NotoSansBengali-Bold.ttf
478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823  NotoSans-Regular.ttf
1df075a380fc7cb898acf64c1f7b3b4dd780de3caa860178bf929de35817a913  NotoSans-Bold.ttf
```

The image `../images/sirat-mark.png` is the programme's mark, the same file as the web's
`apps/web/src/components/public/sirat-mark.png`.
